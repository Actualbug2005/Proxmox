/**
 * /api/cluster/bulk-lifecycle — bulk lifecycle for VMs and CTs.
 *
 * POST — validate + enqueue a batch. Returns 202 with {batchId}; the actual
 *        work happens asynchronously in the orchestrator. Client polls
 *        /api/cluster/bulk-lifecycle/[id] for progress.
 * GET  — list recent batches owned by the current session user.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { requireNodeSysModify } from '@/lib/permissions';
import { RATE_LIMITS, takeToken } from '@/lib/rate-limit';
import {
  createBatch,
  listBatchesForUser,
  type BulkBatch,
  type BulkOp,
  type GuestType,
  type SnapshotParams,
} from '@/lib/bulk-ops';
import { runBulkOp } from '@/lib/run-bulk-op';

// ─── Shared validation ──────────────────────────────────────────────────────

const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;
const SNAPNAME_RE = /^[A-Za-z][A-Za-z0-9_\-]{0,39}$/;
const MAX_TARGETS = 50;
const ALLOWED_OPS: readonly BulkOp[] = ['start', 'stop', 'shutdown', 'reboot', 'snapshot'];
const ALLOWED_GUEST_TYPES: readonly GuestType[] = ['qemu', 'lxc'];

interface RawTarget {
  guestType?: unknown;
  node?: unknown;
  vmid?: unknown;
  name?: unknown;
}

interface CreateBody {
  op?: unknown;
  snapshot?: unknown;
  targets?: unknown;
  maxConcurrent?: unknown;
}

class ValidationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function bad(msg: string): never {
  throw new ValidationError(400, msg);
}

function validateTargets(raw: unknown): Array<{
  guestType: GuestType;
  node: string;
  vmid: number;
  name?: string;
}> {
  if (!Array.isArray(raw)) bad('targets must be an array');
  if (raw.length === 0) bad('targets must not be empty');
  if (raw.length > MAX_TARGETS) bad(`targets exceed cap of ${MAX_TARGETS}`);
  const out: Array<{ guestType: GuestType; node: string; vmid: number; name?: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as RawTarget;
    if (typeof t !== 'object' || t === null) bad(`target[${i}] is not an object`);
    if (typeof t.guestType !== 'string' || !ALLOWED_GUEST_TYPES.includes(t.guestType as GuestType)) {
      bad(`target[${i}].guestType must be 'qemu' or 'lxc'`);
    }
    if (typeof t.node !== 'string' || !NODE_RE.test(t.node)) {
      bad(`target[${i}].node is not a valid node name`);
    }
    if (typeof t.vmid !== 'number' || !Number.isInteger(t.vmid) || t.vmid <= 0) {
      bad(`target[${i}].vmid must be a positive integer`);
    }
    const name = typeof t.name === 'string' && t.name.length <= 128 ? t.name : undefined;
    out.push({
      guestType: t.guestType as GuestType,
      node: t.node,
      vmid: t.vmid,
      name,
    });
  }
  return out;
}

function validateSnapshot(raw: unknown): SnapshotParams {
  if (typeof raw !== 'object' || raw === null) bad('snapshot is required for op="snapshot"');
  const r = raw as { snapname?: unknown; description?: unknown; vmstate?: unknown };
  if (typeof r.snapname !== 'string' || !SNAPNAME_RE.test(r.snapname)) {
    bad('snapshot.snapname must start with a letter and match [A-Za-z0-9_-]{1,40}');
  }
  const description =
    typeof r.description === 'string' && r.description.length <= 256 ? r.description : undefined;
  const vmstate = r.vmstate === true;
  return { snapname: r.snapname, description, vmstate };
}

// ─── DTO ─────────────────────────────────────────────────────────────────────

export interface BulkBatchDto {
  id: string;
  user: string;
  op: BulkOp;
  snapshot?: SnapshotParams;
  createdAt: number;
  finishedAt?: number;
  maxConcurrent: number;
  items: Array<{
    guestType: GuestType;
    node: string;
    vmid: number;
    name?: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
    upid?: string;
    error?: string;
    startedAt?: number;
    finishedAt?: number;
  }>;
}

export function toDto(b: BulkBatch): BulkBatchDto {
  return {
    id: b.id,
    user: b.user,
    op: b.op,
    snapshot: b.snapshot,
    createdAt: b.createdAt,
    finishedAt: b.finishedAt,
    maxConcurrent: b.maxConcurrent,
    // Flatten the discriminated-union item into the loose DTO shape.
    // Each field is pulled only from states where it's guaranteed to exist,
    // so the DTO stays fully optional but the producer is compile-checked.
    items: b.items.map((i) => ({
      guestType: i.guestType,
      node: i.node,
      vmid: i.vmid,
      name: i.name,
      status: i.status,
      upid: 'upid' in i ? i.upid : undefined,
      error: i.status === 'failed' ? i.error : undefined,
      startedAt: i.status === 'pending' || i.status === 'skipped' ? undefined : i.startedAt,
      finishedAt: i.status === 'pending' || i.status === 'running' ? undefined : i.finishedAt,
    })),
  };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export const GET = withAuth(async (_req, { session }) => {
  const batches = listBatchesForUser(session.username, 20);
  return NextResponse.json({ batches: batches.map(toDto) });
});

// ─── POST ────────────────────────────────────────────────────────────────────

export const POST = withCsrf(async (req, { session, sessionId }) => {
  const body = (await req.json().catch(() => ({}))) as CreateBody;

  let op: BulkOp;
  let targets: ReturnType<typeof validateTargets>;
  let snapshot: SnapshotParams | undefined;
  let maxConcurrent: number | undefined;
  try {
    if (typeof body.op !== 'string' || !ALLOWED_OPS.includes(body.op as BulkOp)) {
      bad(`op must be one of: ${ALLOWED_OPS.join(', ')}`);
    }
    op = body.op as BulkOp;
    targets = validateTargets(body.targets);
    if (op === 'snapshot') {
      snapshot = validateSnapshot(body.snapshot);
    }
    if (body.maxConcurrent !== undefined) {
      if (
        typeof body.maxConcurrent !== 'number' ||
        !Number.isInteger(body.maxConcurrent) ||
        body.maxConcurrent <= 0
      ) {
        bad('maxConcurrent must be a positive integer');
      }
      maxConcurrent = body.maxConcurrent;
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  // ACL per-unique-node. If any target's node is forbidden, reject the
  // whole batch — partial allow would be surprising and hard to report.
  const uniqueNodes = Array.from(new Set(targets.map((t) => t.node)));
  for (const n of uniqueNodes) {
    if (!(await requireNodeSysModify(session, n))) {
      return NextResponse.json(
        { error: `Forbidden: Sys.Modify required on /nodes/${n}` },
        { status: 403 },
      );
    }
  }

  // Batch-creation throttle. Per-item PVE calls are gated by the
  // orchestrator's worker pool, not this bucket.
  const token = await takeToken(
    sessionId,
    'cluster.bulkLifecycle',
    RATE_LIMITS.bulkLifecycle.limit,
    RATE_LIMITS.bulkLifecycle.windowMs,
  );
  if (!token.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterMs: token.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((token.retryAfterMs ?? 0) / 1000)) },
      },
    );
  }

  const batch = createBatch({
    user: session.username,
    op,
    snapshot,
    items: targets,
    maxConcurrent,
  });

  // Fire-and-forget. Orchestrator uses the session snapshot for the
  // duration of the batch (max 15 min per item); PVE ticket TTL is ~2h
  // so re-auth mid-batch is not a concern for v1.
  runBulkOp(batch, session);

  return NextResponse.json(
    { batchId: batch.id, itemCount: batch.items.length, batch: toDto(batch) },
    { status: 202 },
  );
});

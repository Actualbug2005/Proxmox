/**
 * In-memory registry for bulk lifecycle batches.
 *
 * Shape is intentionally similar to script-jobs.ts (JobRecord + map +
 * lazy GC timer) but simpler — no log streaming, no disk backing. A
 * batch is a short-lived (<15 min typical) fan-out across a user's
 * selection of guests, so losing them on process restart is the
 * correct failure mode: whatever ran already ran; whatever didn't
 * can be re-queued by the user.
 */

import { randomUUID } from 'node:crypto';

export type BulkOp = 'start' | 'stop' | 'shutdown' | 'reboot' | 'snapshot';
export type GuestType = 'qemu' | 'lxc';
export type ItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface SnapshotParams {
  snapname: string;
  description?: string;
  /** QEMU only — include RAM state. Silently ignored for LXC items. */
  vmstate?: boolean;
}

/**
 * Invariants common to every item, independent of lifecycle state.
 * Broken out so the discriminated variants below can extend without
 * repeating the selection metadata.
 */
interface BulkItemBase {
  guestType: GuestType;
  node: string;
  vmid: number;
  /** Snapshot of the display name at enqueue time — the resource may disappear mid-batch. */
  name?: string;
}

/**
 * Enqueued, not yet picked up by a worker. No timestamps, no UPID.
 * Transitions: → running (worker start) or → skipped (cancel).
 */
export interface PendingBulkItem extends BulkItemBase {
  status: 'pending';
}

/**
 * Worker has started dispatch. `upid` is populated *after* the dispatch
 * call succeeds — if dispatch itself failed we transition straight to
 * failed without ever entering the "running with upid" sub-state.
 */
export interface RunningBulkItem extends BulkItemBase {
  status: 'running';
  startedAt: number;
  upid?: string;
}

/** Terminal success. UPID is always present (dispatch succeeded). */
export interface SuccessBulkItem extends BulkItemBase {
  status: 'success';
  startedAt: number;
  finishedAt: number;
  upid: string;
}

/**
 * Terminal failure. `upid` may be absent when dispatch itself failed
 * (network blip, pveproxy 500). `error` is always set so the UI has
 * a reason string.
 */
export interface FailedBulkItem extends BulkItemBase {
  status: 'failed';
  startedAt: number;
  finishedAt: number;
  error: string;
  upid?: string;
}

/**
 * Cancelled before a worker picked it up. No startedAt — the item
 * never ran. `finishedAt` is stamped for ordering / TTL purposes.
 */
export interface SkippedBulkItem extends BulkItemBase {
  status: 'skipped';
  finishedAt: number;
}

export type BulkItem =
  | PendingBulkItem
  | RunningBulkItem
  | SuccessBulkItem
  | FailedBulkItem
  | SkippedBulkItem;

export interface BulkBatch {
  id: string;
  /** PVE userid, e.g. "root@pam". */
  user: string;
  op: BulkOp;
  snapshot?: SnapshotParams;
  createdAt: number;
  finishedAt?: number;
  items: BulkItem[];
  maxConcurrent: number;
}

export interface CreateBatchInput {
  user: string;
  op: BulkOp;
  snapshot?: SnapshotParams;
  items: Array<BulkItemBase>;
  maxConcurrent?: number;
}

// ─── Storage ────────────────────────────────────────────────────────────────

declare global {
  var __nexusBulkBatches: Map<string, BulkBatch> | undefined;
  var __nexusBulkBatchesGc: NodeJS.Timeout | undefined;
}

const BATCH_TTL_MS = 60 * 60 * 1000; // 1 h — lifecycle ops are short-lived
const GC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 3;

function batches(): Map<string, BulkBatch> {
  if (!globalThis.__nexusBulkBatches) {
    globalThis.__nexusBulkBatches = new Map();
  }
  return globalThis.__nexusBulkBatches;
}

function ensureGc(): void {
  if (globalThis.__nexusBulkBatchesGc) return;
  const t = setInterval(() => {
    const now = Date.now();
    const map = batches();
    for (const [id, b] of map.entries()) {
      if (b.finishedAt && now - b.finishedAt > BATCH_TTL_MS) map.delete(id);
    }
  }, GC_INTERVAL_MS);
  t.unref?.();
  globalThis.__nexusBulkBatchesGc = t;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function createBatch(input: CreateBatchInput): BulkBatch {
  ensureGc();
  const id = randomUUID();
  const batch: BulkBatch = {
    id,
    user: input.user,
    op: input.op,
    snapshot: input.snapshot,
    createdAt: Date.now(),
    items: input.items.map<PendingBulkItem>((i) => ({ ...i, status: 'pending' })),
    maxConcurrent: Math.max(1, Math.min(input.maxConcurrent ?? DEFAULT_MAX_CONCURRENT, 10)),
  };
  batches().set(id, batch);
  return batch;
}

export function getBatch(id: string): BulkBatch | undefined {
  return batches().get(id);
}

export function listBatchesForUser(user: string, limit = 20): BulkBatch[] {
  const out: BulkBatch[] = [];
  for (const b of batches().values()) {
    if (b.user === user) out.push(b);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, limit);
}

// ─── Typed transitions ─────────────────────────────────────────────────────
//
// Each transition mutates one item in place to a valid next state. The
// discriminated BulkItem union guarantees compile-time narrowing — a
// PendingBulkItem can never acquire an `error` field, a SkippedBulkItem
// can never have a `startedAt`, etc.
//
// Unknown batch id / index is a silent no-op (matching the previous
// updateItem contract): worker races with GC can see a ghost item and
// we'd rather drop the write than throw into the orchestrator.

function withItem(batchId: string, index: number, fn: (b: BulkBatch) => BulkItem | null): void {
  const batch = batches().get(batchId);
  if (!batch) return;
  if (index < 0 || index >= batch.items.length) return;
  const next = fn(batch);
  if (next) batch.items[index] = next;
}

/** pending → running. Idempotent if already running. */
export function startItem(batchId: string, index: number, startedAt: number): void {
  withItem(batchId, index, (batch) => {
    const cur = batch.items[index];
    if (cur.status !== 'pending' && cur.status !== 'running') return null;
    if (cur.status === 'running') return null;
    return { guestType: cur.guestType, node: cur.node, vmid: cur.vmid, name: cur.name,
      status: 'running', startedAt };
  });
}

/** running → running + upid. No status change. */
export function attachUpid(batchId: string, index: number, upid: string): void {
  withItem(batchId, index, (batch) => {
    const cur = batch.items[index];
    if (cur.status !== 'running') return null;
    return { ...cur, upid };
  });
}

/** running → success. Requires a UPID (dispatch must have succeeded). */
export function succeedItem(
  batchId: string,
  index: number,
  upid: string,
  finishedAt: number,
): void {
  withItem(batchId, index, (batch) => {
    const cur = batch.items[index];
    if (cur.status !== 'running') return null;
    return { guestType: cur.guestType, node: cur.node, vmid: cur.vmid, name: cur.name,
      status: 'success', startedAt: cur.startedAt, upid, finishedAt };
  });
}

/** running → failed. UPID is optional (dispatch itself may have failed). */
export function failItem(
  batchId: string,
  index: number,
  error: string,
  finishedAt: number,
  upid?: string,
): void {
  withItem(batchId, index, (batch) => {
    const cur = batch.items[index];
    if (cur.status !== 'running') return null;
    return { guestType: cur.guestType, node: cur.node, vmid: cur.vmid, name: cur.name,
      status: 'failed', startedAt: cur.startedAt,
      upid: upid ?? ('upid' in cur ? cur.upid : undefined),
      error, finishedAt };
  });
}

/** pending → skipped. Used by cancelBatch for items a worker never picked up. */
function skipItem(batchId: string, index: number, finishedAt: number): void {
  withItem(batchId, index, (batch) => {
    const cur = batch.items[index];
    if (cur.status !== 'pending') return null;
    return { guestType: cur.guestType, node: cur.node, vmid: cur.vmid, name: cur.name,
      status: 'skipped', finishedAt };
  });
}

/**
 * Recompute + stamp `finishedAt` when every item is terminal. Safe to call
 * repeatedly — a no-op once the batch is already marked finished.
 */
export function tryFinaliseBatch(batchId: string): void {
  const batch = batches().get(batchId);
  if (!batch || batch.finishedAt) return;
  const allTerminal = batch.items.every(
    (i) => i.status === 'success' || i.status === 'failed' || i.status === 'skipped',
  );
  if (allTerminal) batch.finishedAt = Date.now();
}

/** Mark all still-pending items as skipped and finalise. No-op on unknown id. */
export function cancelBatch(batchId: string): boolean {
  const batch = batches().get(batchId);
  if (!batch) return false;
  let changed = false;
  const now = Date.now();
  for (let i = 0; i < batch.items.length; i++) {
    if (batch.items[i].status === 'pending') {
      skipItem(batchId, i, now);
      changed = true;
    }
  }
  tryFinaliseBatch(batchId);
  return changed;
}

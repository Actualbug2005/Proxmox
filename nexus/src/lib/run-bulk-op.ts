/**
 * Bulk lifecycle orchestrator.
 *
 * Fans out per-item PVE lifecycle calls with a fixed worker-pool
 * concurrency cap (default 3) so we never stampede pveproxy. Each
 * worker picks the next pending item, dispatches the PVE call,
 * records the UPID, then polls `nodes/{node}/tasks/{upid}/status`
 * until the task hits a terminal state or a 15-min watchdog fires.
 *
 * Why a worker pool rather than acquireSlot: rate-limit.ts's
 * `acquireSlot` is a REFUSAL primitive (returns null when over cap) —
 * great for gating external requests, but not a queue. A local
 * pool naturally queues items and matches the bulk semantics.
 *
 * Why pveFetch directly rather than the /api/proxmox proxy: we're
 * server-side already; an intra-process HTTP hop would just add
 * latency + a second auth round. The proxy's only job is CSRF +
 * ticket injection, both of which we have access to here.
 */

import { pveFetch } from './pve-fetch.ts';
import {
  tryFinaliseBatch,
  updateItem,
  type BulkBatch,
  type BulkItem,
  type BulkOp,
  type GuestType,
  type SnapshotParams,
} from './bulk-ops.ts';
import type { PVEAuthSession } from '../types/proxmox.ts';

const TASK_POLL_INTERVAL_MS = 2_000;
const ITEM_WATCHDOG_MS = 15 * 60 * 1000;
const JITTER_MIN_MS = 200;
const JITTER_MAX_MS = 500;

// Injection seams for tests. Production path uses the real pveFetch +
// setTimeout; tests replace both to run deterministically.
export interface Deps {
  dispatch: (
    session: PVEAuthSession,
    item: BulkItem,
    op: BulkOp,
    snapshot: SnapshotParams | undefined,
  ) => Promise<string /* UPID */>;
  pollTask: (
    session: PVEAuthSession,
    node: string,
    upid: string,
  ) => Promise<{ terminal: boolean; ok?: boolean; error?: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: Deps = {
  dispatch: dispatchLifecycle,
  pollTask,
  sleep: (ms) => new Promise((res) => {
    const t = setTimeout(res, ms);
    t.unref?.();
  }),
  now: () => Date.now(),
};

/**
 * Fire-and-forget. Caller MUST NOT await completion — this function
 * starts the orchestration and returns immediately. Progress is read
 * via bulk-ops registry.
 */
export function runBulkOp(
  batch: BulkBatch,
  session: PVEAuthSession,
  depsOverride?: Partial<Deps>,
): void {
  const deps = { ...defaultDeps, ...depsOverride };
  void orchestrate(batch, session, deps);
}

async function orchestrate(
  batch: BulkBatch,
  session: PVEAuthSession,
  deps: Deps,
): Promise<void> {
  let nextIdx = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIdx++;
      if (i >= batch.items.length) return;
      await processItem(batch, i, session, deps);
    }
  }

  const workerCount = Math.min(batch.maxConcurrent, batch.items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  try {
    await Promise.allSettled(workers);
  } finally {
    tryFinaliseBatch(batch.id);
  }
}

async function processItem(
  batch: BulkBatch,
  index: number,
  session: PVEAuthSession,
  deps: Deps,
): Promise<void> {
  updateItem(batch.id, index, { status: 'running', startedAt: deps.now() });

  // Small jitter so synchronized waves don't all hit PVE at the same
  // millisecond — keeps pveproxy's per-node queue happier.
  const jitter = JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
  await deps.sleep(jitter);

  const item = batch.items[index];
  let upid: string;
  try {
    upid = await deps.dispatch(session, item, batch.op, batch.snapshot);
  } catch (err) {
    updateItem(batch.id, index, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      finishedAt: deps.now(),
    });
    return;
  }
  updateItem(batch.id, index, { upid });

  // Poll until terminal or watchdog. On watchdog expiry we mark the
  // item failed even though PVE may still be chewing — the user can
  // consult the task list for the real outcome.
  const started = deps.now();
  for (;;) {
    if (deps.now() - started > ITEM_WATCHDOG_MS) {
      updateItem(batch.id, index, {
        status: 'failed',
        error: `Timed out waiting for task (${Math.round(ITEM_WATCHDOG_MS / 60000)} min)`,
        finishedAt: deps.now(),
      });
      return;
    }
    await deps.sleep(TASK_POLL_INTERVAL_MS);
    let res: Awaited<ReturnType<Deps['pollTask']>>;
    try {
      res = await deps.pollTask(session, item.node, upid);
    } catch (err) {
      // Transient poll errors shouldn't fail the item — the next tick
      // might succeed. Only log.
      console.error('[bulk] pollTask error:', {
        batchId: batch.id,
        upid,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!res.terminal) continue;
    updateItem(batch.id, index, {
      status: res.ok ? 'success' : 'failed',
      error: res.ok ? undefined : res.error ?? 'Task failed',
      finishedAt: deps.now(),
    });
    return;
  }
}

// ─── PVE lifecycle dispatch ─────────────────────────────────────────────────

function lifecyclePath(guestType: GuestType, vmid: number, op: BulkOp): string {
  const prefix = guestType === 'qemu' ? 'qemu' : 'lxc';
  const action =
    op === 'start' ? 'start' :
    op === 'stop' ? 'stop' :
    op === 'shutdown' ? 'shutdown' :
    op === 'reboot' ? 'reboot' :
    /* snapshot */ 'snapshot';
  return op === 'snapshot'
    ? `${prefix}/${vmid}/snapshot`
    : `${prefix}/${vmid}/status/${action}`;
}

async function dispatchLifecycle(
  session: PVEAuthSession,
  item: BulkItem,
  op: BulkOp,
  snapshot: SnapshotParams | undefined,
): Promise<string> {
  const path = `https://${session.proxmoxHost}:8006/api2/json/nodes/${encodeURIComponent(item.node)}/${lifecyclePath(item.guestType, item.vmid, op)}`;

  const body = new URLSearchParams();
  if (op === 'snapshot' && snapshot) {
    body.set('snapname', snapshot.snapname);
    if (snapshot.description) body.set('description', snapshot.description);
    // vmstate only meaningful on qemu; skip for LXC even if caller set true.
    if (snapshot.vmstate && item.guestType === 'qemu') body.set('vmstate', '1');
  }

  const res = await pveFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `PVEAuthCookie=${session.ticket}`,
      CSRFPreventionToken: session.csrfToken,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PVE ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  const json = (await res.json()) as { data?: string };
  if (typeof json.data !== 'string') {
    throw new Error('PVE response missing UPID');
  }
  return json.data;
}

// ─── Task polling ───────────────────────────────────────────────────────────

interface PVETaskStatusResponse {
  data?: {
    status?: string;      // 'running' | 'stopped'
    exitstatus?: string;  // 'OK' on success, anything else on failure
  };
}

async function pollTask(
  session: PVEAuthSession,
  node: string,
  upid: string,
): Promise<{ terminal: boolean; ok?: boolean; error?: string }> {
  const url = `https://${session.proxmoxHost}:8006/api2/json/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`;
  const res = await pveFetch(url, {
    headers: { Cookie: `PVEAuthCookie=${session.ticket}` },
  });
  if (!res.ok) {
    throw new Error(`PVE task status ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as PVETaskStatusResponse;
  const d = body.data ?? {};
  // PVE convention: `status` is 'running' while active, 'stopped' when done.
  // `exitstatus` is only set on completion. 'OK' = success; anything else
  // is the failure reason (e.g., "command 'qm reboot' failed: …").
  if (d.status !== 'stopped' || d.exitstatus === undefined) {
    return { terminal: false };
  }
  const ok = d.exitstatus === 'OK';
  return {
    terminal: true,
    ok,
    error: ok ? undefined : d.exitstatus,
  };
}

// Exported for tests / debugging.
export const __internals = { dispatchLifecycle, pollTask, lifecyclePath, orchestrate };

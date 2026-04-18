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

export interface BulkItem {
  guestType: GuestType;
  node: string;
  vmid: number;
  /** Snapshot of the display name at enqueue time — the resource may disappear mid-batch. */
  name?: string;
  status: ItemStatus;
  /** PVE UPID, present once the dispatch call succeeds. */
  upid?: string;
  /** Short reason on failure — propagated to the UI. */
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

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
  items: Array<Omit<BulkItem, 'status' | 'upid' | 'error' | 'startedAt' | 'finishedAt'>>;
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
    items: input.items.map((i) => ({ ...i, status: 'pending' })),
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

/** Mutate one item in place. Silently no-ops if the batch or index is unknown. */
export function updateItem(
  batchId: string,
  index: number,
  patch: Partial<BulkItem>,
): void {
  const batch = batches().get(batchId);
  if (!batch) return;
  const existing = batch.items[index];
  if (!existing) return;
  batch.items[index] = { ...existing, ...patch };
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
  for (let i = 0; i < batch.items.length; i++) {
    if (batch.items[i].status === 'pending') {
      batch.items[i] = { ...batch.items[i], status: 'skipped', finishedAt: Date.now() };
      changed = true;
    }
  }
  tryFinaliseBatch(batchId);
  return changed;
}

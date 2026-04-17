import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

import {
  cancelBatch,
  createBatch,
  getBatch,
  listBatchesForUser,
  tryFinaliseBatch,
  updateItem,
} from './bulk-ops';

beforeEach(() => {
  // Clear the global registry between tests — the module owns the map
  // so we can reach it via globalThis.
  const g = globalThis as unknown as { __nexusBulkBatches?: Map<string, unknown> };
  g.__nexusBulkBatches?.clear();
});

function sampleItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    guestType: 'qemu' as const,
    node: 'pve',
    vmid: 100 + i,
    name: `vm-${100 + i}`,
  }));
}

describe('createBatch', () => {
  it('assigns a uuid, defaults status=pending, clamps maxConcurrent', () => {
    const batch = createBatch({
      user: 'u@pam',
      op: 'reboot',
      items: sampleItems(3),
      maxConcurrent: 99,
    });
    assert.match(batch.id, /^[0-9a-f-]{36}$/);
    assert.equal(batch.user, 'u@pam');
    assert.equal(batch.items.length, 3);
    assert.ok(batch.items.every((i) => i.status === 'pending'));
    assert.equal(batch.maxConcurrent, 10, 'clamped to 10');
  });

  it('floor-clamps maxConcurrent to 1', () => {
    const batch = createBatch({
      user: 'u@pam',
      op: 'start',
      items: sampleItems(1),
      maxConcurrent: 0,
    });
    assert.equal(batch.maxConcurrent, 1);
  });
});

describe('updateItem + tryFinaliseBatch', () => {
  it('advances items and finalises when all terminal', () => {
    const batch = createBatch({ user: 'u@pam', op: 'reboot', items: sampleItems(2) });
    updateItem(batch.id, 0, { status: 'success', finishedAt: 1 });
    tryFinaliseBatch(batch.id);
    assert.equal(getBatch(batch.id)!.finishedAt, undefined, 'still one pending');
    updateItem(batch.id, 1, { status: 'failed', error: 'boom', finishedAt: 2 });
    tryFinaliseBatch(batch.id);
    assert.ok(getBatch(batch.id)!.finishedAt);
  });

  it('ignores unknown batchId / index silently', () => {
    updateItem('nope', 0, { status: 'success' }); // must not throw
    updateItem('nope', 999, {}); // must not throw
  });
});

describe('cancelBatch', () => {
  it('marks pending items as skipped, leaves running items alone, finalises', () => {
    const batch = createBatch({ user: 'u@pam', op: 'shutdown', items: sampleItems(3) });
    updateItem(batch.id, 0, { status: 'running' });
    updateItem(batch.id, 1, { status: 'success', finishedAt: 1 });
    // index 2 stays pending
    const changed = cancelBatch(batch.id);
    assert.equal(changed, true);
    const after = getBatch(batch.id)!;
    assert.equal(after.items[0].status, 'running', 'running items are not cancelled mid-flight');
    assert.equal(after.items[1].status, 'success');
    assert.equal(after.items[2].status, 'skipped');
    assert.equal(after.finishedAt, undefined, 'running item blocks final finalise');
  });

  it('returns false on unknown id', () => {
    assert.equal(cancelBatch('nope'), false);
  });
});

describe('listBatchesForUser', () => {
  it('returns newest-first, scoped to the user, capped at limit', async () => {
    // Tiny waits so createdAt values differ even on fast machines — otherwise
    // two same-ms batches tie on the sort key and stable-sort preserves
    // insertion order, not the intended "newest first".
    const a = createBatch({ user: 'a@pam', op: 'reboot', items: sampleItems(1) });
    await new Promise((r) => setTimeout(r, 2));
    const b = createBatch({ user: 'b@pam', op: 'reboot', items: sampleItems(1) });
    await new Promise((r) => setTimeout(r, 2));
    const a2 = createBatch({ user: 'a@pam', op: 'start', items: sampleItems(1) });
    const outA = listBatchesForUser('a@pam');
    assert.deepEqual(outA.map((x) => x.id), [a2.id, a.id]);
    const outB = listBatchesForUser('b@pam');
    assert.deepEqual(outB.map((x) => x.id), [b.id]);
    const limited = listBatchesForUser('a@pam', 1);
    assert.equal(limited.length, 1);
  });
});

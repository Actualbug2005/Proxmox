import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

import { createBatch, getBatch } from './bulk-ops';
import { __internals, runBulkOp, type Deps } from './run-bulk-op';
import type { PVEAuthSession } from '../types/proxmox';

const fakeSession: PVEAuthSession = {
  ticket: 'fake',
  csrfToken: 'fake',
  username: 'u@pam',
  proxmoxHost: '127.0.0.1',
  ticketIssuedAt: Date.now(),
};

beforeEach(() => {
  const g = globalThis as unknown as { __nexusBulkBatches?: Map<string, unknown> };
  g.__nexusBulkBatches?.clear();
});

// Poll until the predicate is true or budget elapses. Uses a tiny
// deterministic sleep so tests can't hang forever.
async function waitFor(pred: () => boolean, budgetMs = 2_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor timed out after ${budgetMs}ms`);
}

// Build a Deps stub that yields control so the worker pool is observable.
function makeDeps(
  overrides: Partial<Deps> & {
    dispatch?: Deps['dispatch'];
    pollTask?: Deps['pollTask'];
  } = {},
): Deps {
  return {
    dispatch: overrides.dispatch ?? (async () => 'UPID:fake:00000000:00000000:682BED26:qmreboot:100:u@pam:'),
    pollTask: overrides.pollTask ?? (async () => ({ terminal: true, ok: true })),
    sleep: overrides.sleep ?? (async () => {}),
    now: overrides.now ?? (() => Date.now()),
  };
}

describe('runBulkOp — worker pool', () => {
  it('fires every item and marks them success on OK tasks', async () => {
    const batch = createBatch({
      user: 'u@pam',
      op: 'reboot',
      items: [
        { guestType: 'qemu', node: 'pve', vmid: 100 },
        { guestType: 'qemu', node: 'pve', vmid: 101 },
        { guestType: 'lxc',  node: 'pve', vmid: 200 },
      ],
      maxConcurrent: 2,
    });

    runBulkOp(batch, fakeSession, makeDeps());
    await waitFor(() => getBatch(batch.id)!.finishedAt !== undefined);

    const final = getBatch(batch.id)!;
    assert.ok(final.items.every((i) => i.status === 'success'));
    assert.ok(final.items.every((i) => i.upid));
  });

  it('caps concurrency at maxConcurrent', async () => {
    let inflight = 0;
    let peak = 0;
    const deps = makeDeps({
      dispatch: async () => {
        inflight += 1;
        if (inflight > peak) peak = inflight;
        await new Promise((r) => setTimeout(r, 20));
        inflight -= 1;
        return 'UPID:fake:';
      },
    });
    const batch = createBatch({
      user: 'u@pam',
      op: 'start',
      items: Array.from({ length: 6 }, (_, i) => ({
        guestType: 'qemu' as const,
        node: 'pve',
        vmid: 100 + i,
      })),
      maxConcurrent: 2,
    });

    runBulkOp(batch, fakeSession, deps);
    await waitFor(() => getBatch(batch.id)!.finishedAt !== undefined, 5_000);
    assert.ok(peak <= 2, `peak in-flight was ${peak}, should be ≤ 2`);
  });

  it('isolates failures — one bad dispatch does not kill the batch', async () => {
    const deps = makeDeps({
      dispatch: async (_s, item) => {
        if (item.vmid === 101) throw new Error('permission denied');
        return 'UPID:fake:';
      },
    });
    const batch = createBatch({
      user: 'u@pam',
      op: 'shutdown',
      items: [
        { guestType: 'qemu', node: 'pve', vmid: 100 },
        { guestType: 'qemu', node: 'pve', vmid: 101 },
        { guestType: 'qemu', node: 'pve', vmid: 102 },
      ],
    });

    runBulkOp(batch, fakeSession, deps);
    await waitFor(() => getBatch(batch.id)!.finishedAt !== undefined);
    const final = getBatch(batch.id)!;
    assert.equal(final.items[0].status, 'success');
    assert.equal(final.items[1].status, 'failed');
    assert.match(final.items[1].error ?? '', /permission denied/);
    assert.equal(final.items[2].status, 'success');
  });

  it('marks failed when PVE task reports non-OK exitstatus', async () => {
    const deps = makeDeps({
      pollTask: async () => ({ terminal: true, ok: false, error: "command 'qm reboot' failed: VM is locked" }),
    });
    const batch = createBatch({
      user: 'u@pam',
      op: 'reboot',
      items: [{ guestType: 'qemu', node: 'pve', vmid: 100 }],
    });
    runBulkOp(batch, fakeSession, deps);
    await waitFor(() => getBatch(batch.id)!.finishedAt !== undefined);
    assert.equal(getBatch(batch.id)!.items[0].status, 'failed');
    assert.match(getBatch(batch.id)!.items[0].error ?? '', /VM is locked/);
  });
});

describe('lifecyclePath', () => {
  it('maps every op to the correct PVE path', () => {
    const { lifecyclePath } = __internals;
    assert.equal(lifecyclePath('qemu', 100, 'start'),    'qemu/100/status/start');
    assert.equal(lifecyclePath('qemu', 100, 'stop'),     'qemu/100/status/stop');
    assert.equal(lifecyclePath('qemu', 100, 'shutdown'), 'qemu/100/status/shutdown');
    assert.equal(lifecyclePath('qemu', 100, 'reboot'),   'qemu/100/status/reboot');
    assert.equal(lifecyclePath('qemu', 100, 'snapshot'), 'qemu/100/snapshot');
    assert.equal(lifecyclePath('lxc',  200, 'reboot'),   'lxc/200/status/reboot');
    assert.equal(lifecyclePath('lxc',  200, 'snapshot'), 'lxc/200/snapshot');
  });
});

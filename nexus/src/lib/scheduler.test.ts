import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Scoped data dir — must be set BEFORE scheduled-jobs-store is imported,
// since the module reads NEXUS_DATA_DIR at load time.
process.env.NEXUS_DATA_DIR = mkdtempSync(join(tmpdir(), 'nexus-sched-test-'));

const store = await import('./scheduled-jobs-store');
const { __internals } = await import('./scheduler');
import type { SchedulerSource } from './scheduler';
const { runTick, runTickGeneric } = __internals;

async function resetStore() {
  const all = await store.list();
  for (const j of all) await store.remove(j.id);
}

afterEach(resetStore);

describe('scheduler tick', () => {
  it('fires jobs whose cron matches the current minute', async () => {
    const job = await store.create({
      owner: 'test@pam',
      scriptUrl: 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/x.sh',
      scriptName: 'x',
      node: 'pve',
      schedule: '* * * * *',
      enabled: true,
    });

    const seen: string[] = [];
    await runTick(async (j) => {
      seen.push(j.id);
      return { jobId: 'fake-job' };
    });
    assert.deepEqual(seen, [job.id]);

    const after = await store.get(job.id);
    assert.ok(after?.lastFiredAt, 'lastFiredAt should be set');
    assert.equal(after?.lastJobId, 'fake-job');
  });

  it('skips disabled jobs', async () => {
    await store.create({
      owner: 'test@pam',
      scriptUrl: 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/x.sh',
      scriptName: 'x',
      node: 'pve',
      schedule: '* * * * *',
      enabled: false,
    });

    const seen: string[] = [];
    await runTick(async (j) => {
      seen.push(j.id);
      return {};
    });
    assert.equal(seen.length, 0);
  });

  it('dedups inside the dedup window', async () => {
    const job = await store.create({
      owner: 'test@pam',
      scriptUrl: 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/x.sh',
      scriptName: 'x',
      node: 'pve',
      schedule: '* * * * *',
      enabled: true,
    });
    // Mark as just-fired 1 second ago.
    await store.markFired(job.id, 'prev', Date.now() - 1_000);

    const seen: string[] = [];
    await runTick(async (j) => {
      seen.push(j.id);
      return {};
    });
    assert.equal(seen.length, 0, 'should skip inside dedup window');
  });

  it('generic source — fires matching items and calls onFired with handler result', async () => {
    interface FakeItem {
      id: string;
      schedule: string;
      enabled: boolean;
      lastFiredAt?: number;
    }
    const items: FakeItem[] = [
      { id: 'a', schedule: '* * * * *', enabled: true },
      { id: 'b', schedule: '* * * * *', enabled: false },
    ];
    const firedWith: Array<{ id: string; result: { jobId?: string } }> = [];

    const source: SchedulerSource<FakeItem> = {
      name: 'test-generic',
      list: async () => items,
      getId: (i) => i.id,
      getSchedule: (i) => i.schedule,
      isEnabled: (i) => i.enabled,
      getLastFiredAt: (i) => i.lastFiredAt,
      onFired: async (id, at, result) => {
        firedWith.push({ id, result });
        const idx = items.findIndex((x) => x.id === id);
        if (idx !== -1) items[idx].lastFiredAt = at;
      },
    };

    await runTickGeneric(source, async (item) => ({ jobId: `job-${item.id}` }));
    assert.equal(firedWith.length, 1, 'only the enabled item should fire');
    assert.equal(firedWith[0].id, 'a');
    assert.equal(firedWith[0].result.jobId, 'job-a');
  });

  it('stamps lastFiredAt even when the fire handler throws', async () => {
    const job = await store.create({
      owner: 'test@pam',
      scriptUrl: 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/x.sh',
      scriptName: 'x',
      node: 'pve',
      schedule: '* * * * *',
      enabled: true,
    });

    await runTick(async () => {
      throw new Error('boom');
    });
    const after = await store.get(job.id);
    assert.ok(after?.lastFiredAt, 'lastFiredAt should be advanced even on fire failure');
  });

  // ── H4: failure tracking + auto-disable ─────────────────────────────────

  it('records lastFireError and bumps consecutiveFailures when fire throws', async () => {
    const job = await store.create({
      owner: 'test@pam',
      scriptUrl: 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/x.sh',
      scriptName: 'x',
      node: 'pve',
      schedule: '* * * * *',
      enabled: true,
    });

    await runTick(async () => {
      throw new Error('boom one');
    });
    const after1 = await store.get(job.id);
    assert.equal(after1?.lastFireError, 'boom one');
    assert.equal(after1?.consecutiveFailures, 1);

    // Force the dedup gate to let the next tick fire.
    await store.update(job.id, { lastFiredAt: 0 });
    await runTick(async () => {
      throw new Error('boom two');
    });
    const after2 = await store.get(job.id);
    assert.equal(after2?.lastFireError, 'boom two');
    assert.equal(after2?.consecutiveFailures, 2);
  });

  it('clears lastFireError + resets counter on a successful fire', async () => {
    const job = await store.create({
      owner: 'test@pam',
      scriptUrl: 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/x.sh',
      scriptName: 'x',
      node: 'pve',
      schedule: '* * * * *',
      enabled: true,
    });

    await runTick(async () => {
      throw new Error('first failure');
    });
    await store.update(job.id, { lastFiredAt: 0 });
    await runTick(async () => ({ jobId: 'recovered-job' }));

    const after = await store.get(job.id);
    assert.equal(after?.lastFireError, undefined, 'lastFireError cleared after success');
    assert.equal(after?.consecutiveFailures, 0, 'counter reset to 0');
    assert.equal(after?.lastJobId, 'recovered-job');
  });

  it('auto-disables the job after MAX_CONSECUTIVE_FAILURES failed fires', async () => {
    const { MAX_CONSECUTIVE_FAILURES } = await import('./scheduler');

    const job = await store.create({
      owner: 'test@pam',
      scriptUrl: 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/x.sh',
      scriptName: 'x',
      node: 'pve',
      schedule: '* * * * *',
      enabled: true,
    });

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      await store.update(job.id, { lastFiredAt: 0 });
      await runTick(async () => {
        throw new Error(`failure ${i + 1}`);
      });
    }

    const after = await store.get(job.id);
    assert.equal(after?.consecutiveFailures, MAX_CONSECUTIVE_FAILURES);
    assert.equal(after?.enabled, false, 'should be auto-disabled at the threshold');
  });
});

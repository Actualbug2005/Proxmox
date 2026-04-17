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
const { runTick } = __internals;

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
});

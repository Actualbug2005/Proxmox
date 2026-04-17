import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Scope NEXUS_DATA_DIR to a fresh temp dir BEFORE importing the store —
// the module reads the env var at load time.
const TMP = mkdtempSync(join(tmpdir(), 'nexus-chains-test-'));
process.env.NEXUS_DATA_DIR = TMP;

const store = await import('./chains-store');

async function wipe() {
  const all = await store.list();
  for (const c of all) await store.remove(c.id);
}

beforeEach(async () => {
  await wipe();
});

function sampleStep(i: number) {
  return {
    scriptUrl: `https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/step${i}.sh`,
    scriptName: `step-${i}`,
    node: 'pve',
  };
}

describe('chains-store', () => {
  it('create assigns id, defaults policy + enabled', async () => {
    const c = await store.create({
      owner: 'u@pam',
      name: 'test',
      steps: [sampleStep(1), sampleStep(2)],
    });
    assert.match(c.id, /^[0-9a-f-]{36}$/);
    assert.equal(c.policy, 'halt-on-failure');
    assert.equal(c.enabled, true);
    assert.equal(c.steps.length, 2);
  });

  it('listForUser isolates chains to their owner', async () => {
    await store.create({ owner: 'a@pam', name: 'a', steps: [sampleStep(1)] });
    await store.create({ owner: 'b@pam', name: 'b', steps: [sampleStep(1)] });
    const a = await store.listForUser('a@pam');
    const b = await store.listForUser('b@pam');
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].name, 'a');
    assert.equal(b[0].name, 'b');
  });

  it('update patches while preserving id + owner + createdAt', async () => {
    const c = await store.create({ owner: 'u@pam', name: 'x', steps: [sampleStep(1)] });
    const originalCreated = c.createdAt;
    const updated = await store.update(c.id, {
      name: 'y',
      description: 'new desc',
      enabled: false,
      // Attempt to hijack owner — should be ignored.
      owner: 'attacker@pam' as never,
    } as never);
    assert.ok(updated);
    assert.equal(updated!.id, c.id);
    assert.equal(updated!.owner, 'u@pam');
    assert.equal(updated!.createdAt, originalCreated);
    assert.equal(updated!.name, 'y');
    assert.equal(updated!.description, 'new desc');
    assert.equal(updated!.enabled, false);
  });

  it('update returns null on unknown id', async () => {
    const result = await store.update('nope', { name: 'y' });
    assert.equal(result, null);
  });

  it('remove returns true on hit, false on miss', async () => {
    const c = await store.create({ owner: 'u@pam', name: 'x', steps: [sampleStep(1)] });
    assert.equal(await store.remove(c.id), true);
    assert.equal(await store.remove(c.id), false);
    assert.equal((await store.list()).length, 0);
  });

  it('setLastRun persists step run records', async () => {
    const c = await store.create({ owner: 'u@pam', name: 'x', steps: [sampleStep(1), sampleStep(2)] });
    await store.setLastRun(c.id, [
      { stepIndex: 0, status: 'success', jobId: 'job-a' },
      { stepIndex: 1, status: 'running', jobId: 'job-b' },
    ]);
    const after = await store.get(c.id);
    assert.equal(after!.lastRun?.length, 2);
    assert.equal(after!.lastRun?.[0].status, 'success');
    assert.equal(after!.lastRun?.[1].jobId, 'job-b');
  });

  it('markFired stamps lastFiredAt without touching other fields', async () => {
    const c = await store.create({ owner: 'u@pam', name: 'x', steps: [sampleStep(1)] });
    const at = Date.now();
    await store.markFired(c.id, at);
    const after = await store.get(c.id);
    assert.equal(after!.lastFiredAt, at);
    assert.equal(after!.name, 'x');
  });

  it('setLastRun / markFired on unknown id are silent no-ops', async () => {
    await store.setLastRun('nope', []);
    await store.markFired('nope', 1);
    // Just assert no throw; nothing to read back.
  });
});

// Clean up the temp dir at process exit.
process.on('exit', () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

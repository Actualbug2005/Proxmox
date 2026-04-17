import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the chains store at a fresh temp dir before we import either
// module — both read NEXUS_DATA_DIR at load time.
process.env.NEXUS_DATA_DIR = mkdtempSync(join(tmpdir(), 'nexus-run-chain-test-'));

const store = await import('./chains-store');
const { runChain } = await import('./run-chain');
import type { Chain, ChainStep } from './chains-store';
import type { JobRecord, JobStatus } from './script-jobs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStep(i: number, node = 'pve'): ChainStep {
  return {
    scriptUrl: `https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/step${i}.sh`,
    scriptName: `step-${i}`,
    node,
  };
}

/**
 * Build a deterministic fake for the fire/poll pair. Each call to
 * runScriptJob returns a synthetic jobId whose eventual terminal status
 * comes from the `statusForStep` callback.
 */
function makeDeps(statusForStep: (stepIdx: number) => JobStatus, exitCodeForStep?: (stepIdx: number) => number | null) {
  let callIndex = -1;
  const records = new Map<string, { status: JobStatus; exitCode: number | null }>();

  return {
    runScriptJob: async () => {
      callIndex += 1;
      const jobId = `fake-job-${callIndex}`;
      records.set(jobId, { status: 'running', exitCode: null });
      // Schedule the terminal transition before the runner's first poll.
      // Tests use sleep=noop so the transition happens before the loop
      // looks at the record.
      const idx = callIndex;
      setImmediate(() => {
        records.set(jobId, {
          status: statusForStep(idx),
          exitCode: exitCodeForStep ? exitCodeForStep(idx) : statusForStep(idx) === 'success' ? 0 : 1,
        });
      });
      return { jobId, startedAt: Date.now(), rejectedEnvKeys: [] };
    },
    getJob: (id: string): JobRecord | undefined => {
      const r = records.get(id);
      if (!r) return undefined;
      return {
        id,
        node: 'pve',
        scriptUrl: 'x',
        scriptName: 'x',
        user: 'u@pam',
        status: r.status,
        startedAt: 0,
        logPath: '',
        tail: '',
        exitCode: r.exitCode,
      };
    },
    sleep: async () => {
      // Yield to the microtask queue so setImmediate fires.
      await new Promise((r) => setImmediate(r));
    },
    now: () => Date.now(),
  };
}

async function waitForChainDone(id: string, budgetMs = 2_000): Promise<Chain> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const c = await store.get(id);
    if (c?.lastRun && c.lastRun.every((s) => s.status === 'success' || s.status === 'failed' || s.status === 'skipped')) {
      return c;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('chain never terminated');
}

beforeEach(async () => {
  const all = await store.list();
  for (const c of all) await store.remove(c.id);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runChain', () => {
  it('happy path — all steps succeed, halt policy', async () => {
    const c = await store.create({
      owner: 'u@pam',
      name: 'happy',
      steps: [makeStep(1), makeStep(2), makeStep(3)],
    });

    runChain(c, { deps: makeDeps(() => 'success') });

    const done = await waitForChainDone(c.id);
    assert.equal(done.lastRun?.length, 3);
    assert.ok(done.lastRun?.every((r) => r.status === 'success'));
    assert.ok(done.lastRun?.every((r) => typeof r.jobId === 'string'));
  });

  it('halt-on-failure — step 2 fails, step 3 is skipped', async () => {
    const c = await store.create({
      owner: 'u@pam',
      name: 'halt',
      policy: 'halt-on-failure',
      steps: [makeStep(1), makeStep(2), makeStep(3)],
    });

    runChain(c, {
      deps: makeDeps((i) => (i === 1 ? 'failed' : 'success')),
    });

    const done = await waitForChainDone(c.id);
    assert.equal(done.lastRun?.[0].status, 'success');
    assert.equal(done.lastRun?.[1].status, 'failed');
    assert.equal(done.lastRun?.[2].status, 'skipped');
  });

  it('continue — step 2 fails, step 3 still runs', async () => {
    const c = await store.create({
      owner: 'u@pam',
      name: 'continue',
      policy: 'continue',
      steps: [makeStep(1), makeStep(2), makeStep(3)],
    });

    runChain(c, {
      deps: makeDeps((i) => (i === 1 ? 'failed' : 'success')),
    });

    const done = await waitForChainDone(c.id);
    assert.equal(done.lastRun?.[0].status, 'success');
    assert.equal(done.lastRun?.[1].status, 'failed');
    assert.equal(done.lastRun?.[2].status, 'success');
  });

  it('aborted job is surfaced as failed with "Aborted by user"', async () => {
    const c = await store.create({
      owner: 'u@pam',
      name: 'abort',
      steps: [makeStep(1)],
    });

    runChain(c, { deps: makeDeps(() => 'aborted') });

    const done = await waitForChainDone(c.id);
    assert.equal(done.lastRun?.[0].status, 'failed');
    assert.match(done.lastRun?.[0].error ?? '', /Aborted/);
  });

  it('validation failure on a bad scriptUrl fails the step without firing', async () => {
    const c = await store.create({
      owner: 'u@pam',
      name: 'bad-url',
      steps: [
        {
          scriptUrl: 'https://evil.example/hack.sh',
          scriptName: 'nope',
          node: 'pve',
        },
      ],
    });

    let fired = 0;
    const deps = makeDeps(() => 'success');
    const origFire = deps.runScriptJob;
    deps.runScriptJob = async (...args) => {
      fired += 1;
      return origFire(...args);
    };

    runChain(c, { deps });

    const done = await waitForChainDone(c.id);
    assert.equal(done.lastRun?.[0].status, 'failed');
    assert.equal(fired, 0, 'runScriptJob must not be called when url validation fails');
  });

  it('seeds lastRun with pending rows before firing the first step', async () => {
    const c = await store.create({
      owner: 'u@pam',
      name: 'seed',
      steps: [makeStep(1), makeStep(2)],
    });

    // Delay the fire so we can observe the pending seed.
    let seeded = false;
    const deps = makeDeps(() => 'success');
    const origFire = deps.runScriptJob;
    deps.runScriptJob = async (...args) => {
      if (!seeded) {
        const now = await store.get(c.id);
        // By the time runScriptJob is first called the seed has landed.
        assert.equal(now?.lastRun?.length, 2);
        seeded = true;
      }
      return origFire(...args);
    };

    runChain(c, { deps });
    await waitForChainDone(c.id);
    assert.ok(seeded, 'expected to observe the pending seed');
  });
});

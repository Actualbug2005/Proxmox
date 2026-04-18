/**
 * Chain runner.
 *
 * Fires the steps of a Chain in order. Each step fires via runScriptJob
 * (fire-and-forget, returns a jobId) and then polls getJob(jobId).status
 * every pollIntervalMs until terminal. On failure, halt-on-failure
 * policy stops the chain and marks remaining steps 'skipped'; continue
 * policy soldiers on.
 *
 * Pure server-side. Designed to be callable from /api/scripts/chains/
 * [id]/run and from the scheduler tick. Fire-and-forget at the caller
 * level: runChain() returns immediately and drives the loop async.
 */

import {
  type Chain,
  type ChainStep,
  type ChainStepRun,
  setLastRun,
} from './chains-store.ts';
import { getJob, type JobStatus } from './script-jobs.ts';
import { runScriptJob, validateNodeName, validateScriptUrl } from './run-script-job.ts';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_STEP_WATCHDOG_MS = 30 * 60 * 1000;
const DEFAULT_STEP_TIMEOUT_MS = 15 * 60 * 1000;

// Dependency injection seams so tests can replace runScriptJob / getJob
// with deterministic stubs, without mocking the entire script-jobs
// module graph.
export interface RunChainDeps {
  runScriptJob: typeof runScriptJob;
  getJob: typeof getJob;
  /** Wait `ms` and resolve. Test stub is instant. */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: RunChainDeps = {
  runScriptJob,
  getJob,
  sleep: (ms) => new Promise((res) => {
    const t = setTimeout(res, ms);
    t.unref?.();
  }),
  now: () => Date.now(),
};

export interface RunChainOptions {
  pollIntervalMs?: number;
  /** Upper bound per step. Defaults to 30 min — longer than a typical
   *  Community Script install but short enough to fail an obviously-stuck run. */
  stepWatchdogMs?: number;
  deps?: Partial<RunChainDeps>;
}

/**
 * Kicks off chain execution. Returns immediately — the actual fires +
 * polls happen async. UI polls `chains-store.get(id).lastRun` for progress.
 */
export function runChain(chain: Chain, opts: RunChainOptions = {}): void {
  void drive(chain, opts);
}

async function drive(chain: Chain, opts: RunChainOptions): Promise<void> {
  const deps: RunChainDeps = { ...defaultDeps, ...(opts.deps ?? {}) };
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const watchdogMs = opts.stepWatchdogMs ?? DEFAULT_STEP_WATCHDOG_MS;

  // Seed lastRun with pending rows for every step so the UI sees the
  // chain as in-flight the moment it fires.
  const runRows: ChainStepRun[] = chain.steps.map((_, i) => ({
    stepIndex: i,
    status: 'pending',
  }));
  await setLastRun(chain.id, runRows);

  let halted = false;

  for (let i = 0; i < chain.steps.length; i++) {
    if (halted) {
      runRows[i] = { stepIndex: i, status: 'skipped' };
      await setLastRun(chain.id, runRows);
      continue;
    }

    const step = chain.steps[i];
    const startedAt = deps.now();
    runRows[i] = { stepIndex: i, status: 'running', startedAt };
    await setLastRun(chain.id, runRows);

    const outcome = await runOneStep(chain, step, deps, pollMs, watchdogMs);
    const finishedAt = deps.now();
    if (outcome.status === 'success') {
      // success requires jobId — runOneStep guarantees it.
      runRows[i] = {
        stepIndex: i,
        status: 'success',
        startedAt,
        finishedAt,
        jobId: outcome.jobId!,
      };
    } else {
      runRows[i] = {
        stepIndex: i,
        status: 'failed',
        startedAt,
        finishedAt,
        error: outcome.error ?? 'Unknown error',
        jobId: outcome.jobId,
      };
      if (chain.policy === 'halt-on-failure') halted = true;
    }
    await setLastRun(chain.id, runRows);
  }
}

interface StepOutcome {
  status: 'success' | 'failed';
  jobId?: string;
  error?: string;
}

async function runOneStep(
  chain: Chain,
  step: ChainStep,
  deps: RunChainDeps,
  pollMs: number,
  watchdogMs: number,
): Promise<StepOutcome> {
  // Re-validate at fire time — a stored chain may outlive an allow-list
  // tightening, so the scheduler ticking 3 months later must still
  // refuse malformed steps.
  try {
    validateNodeName(step.node);
    validateScriptUrl(step.scriptUrl);
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let started: { jobId: string };
  try {
    started = await deps.runScriptJob({
      user: chain.owner,
      node: step.node,
      scriptUrl: step.scriptUrl,
      scriptName: step.scriptName,
      slug: step.slug,
      method: step.method,
      env: step.env,
      timeoutMs: step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
    });
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const jobId = started.jobId;
  const deadline = deps.now() + watchdogMs;

  for (;;) {
    if (deps.now() > deadline) {
      return {
        status: 'failed',
        jobId,
        error: `Step watchdog expired (${Math.round(watchdogMs / 60_000)} min)`,
      };
    }
    await deps.sleep(pollMs);
    const rec = deps.getJob(jobId);
    if (!rec) {
      // Record evicted by GC — treat as failed rather than hang forever.
      return {
        status: 'failed',
        jobId,
        error: 'Job record evicted before completion',
      };
    }
    const terminal = (['success', 'failed', 'aborted'] as JobStatus[]).includes(rec.status);
    if (!terminal) continue;
    if (rec.status === 'success') {
      return { status: 'success', jobId };
    }
    return {
      status: 'failed',
      jobId,
      error: rec.status === 'aborted' ? 'Aborted by user' : `Exit ${rec.exitCode ?? '?'}`,
    };
  }
}

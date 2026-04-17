/**
 * Scheduler tick — polls the scheduled-jobs store every SCHED_TICK_MS and
 * fires any jobs whose cron matches the current minute.
 *
 * Phase 1 delivers the loop + state updates only. The `fire` handler that
 * actually spawns the script is passed in from outside (server.ts on
 * startup) so the scheduling logic stays independent of the executor, and
 * tests can plug in a stub.
 *
 * Dedup: minute-granularity matching can fire twice in the same minute
 * because our tick drifts. `lastFiredAt` is the guard — a job that fired
 * less than DEDUP_WINDOW_MS ago is skipped regardless of cron match.
 *
 * HMR safety: Next.js dev mode may re-evaluate this module. We stash the
 * interval handle on globalThis so repeated `startScheduler` calls clear
 * the old timer instead of stacking multiple loops.
 */

import { matchesCron } from './cron-match';
import * as store from './scheduled-jobs-store';

const SCHED_TICK_MS = 60_000;
const DEDUP_WINDOW_MS = 55_000;

export type FireHandler = (job: store.ScheduledJob) => Promise<{ jobId?: string }>;

declare global {
  // eslint-disable-next-line no-var
  var __nexusSchedulerTimer: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __nexusSchedulerTickRunning: boolean | undefined;
}

async function runTick(fire: FireHandler, now: Date = new Date()): Promise<void> {
  // Refuse to overlap ticks — a slow fire handler mustn't cause the next
  // tick to fan out a second copy of the same fires.
  if (globalThis.__nexusSchedulerTickRunning) return;
  globalThis.__nexusSchedulerTickRunning = true;
  try {
    const jobs = await store.list();
    const nowMs = now.getTime();
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!matchesCron(job.schedule, now)) continue;
      if (job.lastFiredAt && nowMs - job.lastFiredAt < DEDUP_WINDOW_MS) continue;

      let result: { jobId?: string };
      try {
        result = await fire(job);
      } catch (err) {
        console.error('[scheduler] fire failed:', {
          id: job.id,
          scriptName: job.scriptName,
          error: err instanceof Error ? err.message : String(err),
        });
        // Still stamp lastFiredAt — retrying immediately would just fail
        // again and spam logs. A failed fire surfaces in audit + job logs;
        // the user fixes whatever's wrong and the next matching minute
        // picks it up.
        result = { jobId: undefined };
      }
      await store.markFired(job.id, result.jobId, nowMs);
    }
  } finally {
    globalThis.__nexusSchedulerTickRunning = false;
  }
}

export function startScheduler(fire: FireHandler): () => void {
  // Clear any existing timer first — cheap defence against HMR double-start.
  if (globalThis.__nexusSchedulerTimer) {
    clearInterval(globalThis.__nexusSchedulerTimer);
  }

  const timer = setInterval(() => {
    void runTick(fire);
  }, SCHED_TICK_MS);
  timer.unref?.();
  globalThis.__nexusSchedulerTimer = timer;

  console.info(`[scheduler] started (tick ${SCHED_TICK_MS}ms, dedup ${DEDUP_WINDOW_MS}ms)`);

  return () => {
    if (globalThis.__nexusSchedulerTimer === timer) {
      clearInterval(timer);
      globalThis.__nexusSchedulerTimer = undefined;
    }
  };
}

// Exported for unit tests.
export const __internals = { runTick };

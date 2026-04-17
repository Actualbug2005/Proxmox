/**
 * Cron-driven scheduler — polls a `SchedulerSource<T>` every SCHED_TICK_MS
 * and fires items whose cron matches the current minute.
 *
 * The core loop is generic so scheduled single-script jobs and scheduled
 * chains can share one tick discipline (dedup window, overlap guard,
 * HMR-safe timer stash) without duplicated plumbing. Each source owns its
 * own list / isEnabled / getLastFiredAt / onFired, so the file-store
 * signatures stay independent.
 *
 * Dedup: minute-granularity matching can fire twice in the same minute
 * because our tick drifts. `getLastFiredAt` is the guard — an item that
 * fired less than DEDUP_WINDOW_MS ago is skipped regardless of cron match.
 *
 * HMR safety: Next.js dev mode may re-evaluate this module. We stash the
 * interval handle + tick-running flag on globalThis, keyed by source.name,
 * so repeated starts clear the old timer instead of stacking loops and
 * the chain + scripts schedulers don't fight over a single flag.
 */

// Explicit .ts extensions — these modules are reached from server.ts which
// runs under Node's --experimental-strip-types (no bundler resolver).
import { matchesCron } from './cron-match.ts';
import * as scriptsStore from './scheduled-jobs-store.ts';

const SCHED_TICK_MS = 60_000;
const DEDUP_WINDOW_MS = 55_000;

export type FireResult = { jobId?: string };
export type FireHandler = (job: scriptsStore.ScheduledJob) => Promise<FireResult>;

/**
 * Adapter between a domain store (scheduled-jobs-store, chains-store, …)
 * and the generic tick. `name` must be stable across restarts because it
 * keys the HMR-safe globals; different sources MUST pick different names.
 */
export interface SchedulerSource<T> {
  name: string;
  list(): Promise<T[]>;
  getId(item: T): string;
  /** `undefined` / empty = ad-hoc only; the scheduler skips it. */
  getSchedule(item: T): string | undefined;
  isEnabled(item: T): boolean;
  getLastFiredAt(item: T): number | undefined;
  onFired(id: string, at: number, result: FireResult): Promise<void>;
}

declare global {
  var __nexusSchedulerTimers: Record<string, NodeJS.Timeout> | undefined;
  var __nexusSchedulerTickRunning: Record<string, boolean> | undefined;
}

function getTimers(): Record<string, NodeJS.Timeout> {
  if (!globalThis.__nexusSchedulerTimers) globalThis.__nexusSchedulerTimers = {};
  return globalThis.__nexusSchedulerTimers;
}

function getRunFlags(): Record<string, boolean> {
  if (!globalThis.__nexusSchedulerTickRunning) globalThis.__nexusSchedulerTickRunning = {};
  return globalThis.__nexusSchedulerTickRunning;
}

async function runTick<T>(
  source: SchedulerSource<T>,
  fire: (item: T) => Promise<FireResult>,
  now: Date = new Date(),
): Promise<void> {
  const flags = getRunFlags();
  if (flags[source.name]) return;
  flags[source.name] = true;
  try {
    const items = await source.list();
    const nowMs = now.getTime();
    for (const item of items) {
      if (!source.isEnabled(item)) continue;
      const schedule = source.getSchedule(item);
      if (!schedule) continue;
      if (!matchesCron(schedule, now)) continue;
      const lastFiredAt = source.getLastFiredAt(item);
      if (lastFiredAt && nowMs - lastFiredAt < DEDUP_WINDOW_MS) continue;

      let result: FireResult;
      try {
        result = await fire(item);
      } catch (err) {
        console.error('[scheduler] fire failed:', {
          source: source.name,
          id: source.getId(item),
          error: err instanceof Error ? err.message : String(err),
        });
        // Still stamp lastFiredAt — retrying immediately would just fail
        // again and spam logs. A failed fire surfaces in audit + item logs;
        // the user fixes whatever's wrong and the next matching minute
        // picks it up.
        result = { jobId: undefined };
      }
      await source.onFired(source.getId(item), nowMs, result);
    }
  } finally {
    flags[source.name] = false;
  }
}

export function startSchedulerSource<T>(
  source: SchedulerSource<T>,
  fire: (item: T) => Promise<FireResult>,
): () => void {
  const timers = getTimers();
  const prev = timers[source.name];
  if (prev) clearInterval(prev);

  const timer = setInterval(() => {
    void runTick(source, fire);
  }, SCHED_TICK_MS);
  timer.unref?.();
  timers[source.name] = timer;

  console.info('[scheduler] started', {
    source: source.name,
    tickMs: SCHED_TICK_MS,
    dedupMs: DEDUP_WINDOW_MS,
  });

  return () => {
    if (timers[source.name] === timer) {
      clearInterval(timer);
      delete timers[source.name];
    }
  };
}

// ─── Backward-compat: scripts-only entrypoint ────────────────────────────────

const scriptsSource: SchedulerSource<scriptsStore.ScheduledJob> = {
  name: 'scripts',
  list: () => scriptsStore.list(),
  getId: (j) => j.id,
  getSchedule: (j) => j.schedule,
  isEnabled: (j) => j.enabled,
  getLastFiredAt: (j) => j.lastFiredAt,
  onFired: (id, at, result) => scriptsStore.markFired(id, result.jobId, at),
};

/** @deprecated Prefer `startSchedulerSource(source, fire)`. Kept for the
 *  legacy single-script scheduler wiring in server.ts. */
export function startScheduler(fire: FireHandler): () => void {
  return startSchedulerSource(scriptsSource, fire);
}

// Exported for unit tests. The scripts variant is the original contract;
// chain tests construct their own SchedulerSource and call runTick directly.
export const __internals = {
  runTick: (fire: FireHandler, now?: Date) => runTick(scriptsSource, fire, now),
  runTickGeneric: runTick,
};

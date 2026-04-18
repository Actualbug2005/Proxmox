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

/**
 * Auto-disable a schedule after this many consecutive failed fires. A
 * schedule that's been broken for 5 straight minutes is almost certainly
 * broken for a structural reason (script URL gone, node offline, ACL
 * revoked) — stop hammering it until the operator acknowledges. They
 * re-enable from the UI once they've fixed whatever broke.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** FireResult shape. Set `error` when the fire failed so the source can
 *  persist it and the counter/auto-disable logic can react. */
export type FireResult = { jobId?: string; error?: string };
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
  /** Current consecutive-failure count for the item. Missing = 0. */
  getConsecutiveFailures?(item: T): number | undefined;
  onFired(id: string, at: number, result: FireResult): Promise<void>;
  /** Optional auto-disable hook. When consecutive failures reach
   *  MAX_CONSECUTIVE_FAILURES, the scheduler calls this so the store can
   *  flip `enabled=false`. Sources that don't implement it get logged
   *  warnings instead of an auto-disable. */
  disable?(id: string, reason: string): Promise<void>;
}

declare global {
  var __nexusSchedulerTimers: Record<string, NodeJS.Timeout> | undefined;
  var __nexusSchedulerTickRunning: Record<string, boolean> | undefined;
   
  var __nexusSchedulerFireFailures: number | undefined;
}

export function getSchedulerFireFailureCount(): number {
  return globalThis.__nexusSchedulerFireFailures ?? 0;
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
        const reason = err instanceof Error ? err.message : String(err);
        globalThis.__nexusSchedulerFireFailures =
          (globalThis.__nexusSchedulerFireFailures ?? 0) + 1;
        console.error(
          '[nexus event=scheduler_fire_failed] source=%s id=%s reason=%s',
          source.name,
          source.getId(item),
          reason,
        );
        // Capture the error so onFired can persist it. Still stamp
        // lastFiredAt — retrying immediately within this minute would just
        // fail again. The operator sees the error via
        // `lastFireError`/`consecutiveFailures`/the auto-disable below.
        result = { error: reason };
      }
      await source.onFired(source.getId(item), nowMs, result);

      // Auto-disable after MAX_CONSECUTIVE_FAILURES consecutive failures.
      // Only runs when the source exposes the optional helpers — legacy
      // sources without them retain the old "stamp and try again" loop.
      if (result.error && source.disable && source.getConsecutiveFailures) {
        // Re-list after onFired so we see the just-persisted counter.
        const refreshed = (await source.list()).find(
          (x) => source.getId(x) === source.getId(item),
        );
        const failures = refreshed ? source.getConsecutiveFailures(refreshed) ?? 0 : 0;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          const reason = `auto-disabled after ${failures} consecutive failures; last error: ${result.error}`;
          console.error(
            '[nexus event=scheduler_auto_disabled] source=%s id=%s failures=%d',
            source.name,
            source.getId(item),
            failures,
          );
          try {
            await source.disable(source.getId(item), reason);
          } catch (err) {
            // Disable itself failing is a separate problem — log and
            // move on; next tick will see enabled=true and try again.
            console.error(
              '[scheduler] auto-disable failed: source=%s id=%s err=%s',
              source.name,
              source.getId(item),
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }
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
  getConsecutiveFailures: (j) => j.consecutiveFailures,
  onFired: (id, at, result) => scriptsStore.markFired(id, result.jobId, at, result.error),
  disable: async (id) => {
    await scriptsStore.update(id, { enabled: false });
  },
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

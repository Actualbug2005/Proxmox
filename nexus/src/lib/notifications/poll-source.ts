/**
 * Metric polling source for the notification engine.
 *
 * Every tick (default 60s, matching the scheduler's cadence) this
 * module:
 *   1. Fetches cluster state — resources, per-node statuses, recent tasks
 *   2. Computes the five v1 metrics (dotted names; scope carries the
 *      per-resource dimension)
 *   3. For each (metric, scope) tuple, emits a `metric.threshold.crossed`
 *      event. Rules don't need to be consulted here — the dispatcher's
 *      rule-matcher filters on its own, and the backoff state machine
 *      handles "predicate already fired" suppression.
 *   4. Detects "cleared" transitions: a rule is cleared when its scope's
 *      value went from matching on a previous tick to NOT matching now,
 *      AND the rule has `consecutiveFires > 0`. Polled metrics clear
 *      instantly; pushed-event rules use a time-based clearAfterMs in a
 *      separate sweep (see `sweepPushedClears`).
 *
 * The tick is started from server.ts at boot via `startPollSource()`.
 * HMR stash on globalThis so dev reloads don't spawn duplicate timers.
 *
 * Why compute metrics here rather than import a shared module: the
 * cluster-pressure helper operates on client-side hook data; this is
 * server-side polling. The overlap isn't worth a shared abstraction —
 * metrics are a dozen lines of arithmetic over the same wire types.
 */

import type { ClusterResourcePublic, NodeStatus, PVETask } from '@/types/proxmox';
import { emit } from './event-bus.ts';
import type { MetricEvent } from './types.ts';
import { listRules, markRuleCleared, markRuleFired } from './store.ts';
import { matchesEvent } from './rule-matcher.ts';
import { shouldFireResolve } from './backoff.ts';

const DEFAULT_TICK_MS = 60_000;

/**
 * Canonical dotted-hierarchy metric names emitted by this source.
 * Keep in sync with the rule editor's metric dropdown in the UI.
 */
export const METRIC_NAMES = [
  'cluster.cpu.avg',
  'cluster.mem.avg',
  'node.cpu.max',
  'node.loadavg.per_core',
  'guests.failing.count',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export interface MetricReading {
  metric: MetricName;
  value: number;
  scope: string;
}

/**
 * Pure function: given a cluster snapshot, yield every metric reading
 * that this source can compute. Exported so tests can feed fixtures
 * without spinning up a fake PVE.
 *
 * Scope convention:
 *   - `cluster`         — cluster-wide scalar (single reading per metric)
 *   - `node:<name>`     — per-node reading (one per online node)
 */
export function computeMetrics(
  resources: readonly ClusterResourcePublic[],
  nodeStatuses: Record<string, NodeStatus | undefined>,
): MetricReading[] {
  const nodes = resources.filter((r) => r.type === 'node');
  const onlineNodes = nodes.filter((n) => n.status === 'online');
  const guests = resources.filter((r) => r.type === 'qemu' || r.type === 'lxc');

  const out: MetricReading[] = [];

  // ── cluster.cpu.avg, cluster.mem.avg ────────────────────────────────────
  let cpuSum = 0, cpuN = 0, memSum = 0, memN = 0;
  for (const n of onlineNodes) {
    if (n.cpu !== undefined) { cpuSum += n.cpu; cpuN += 1; }
    if (n.mem !== undefined && n.maxmem && n.maxmem > 0) {
      memSum += n.mem / n.maxmem;
      memN += 1;
    }
  }
  out.push({ metric: 'cluster.cpu.avg', value: cpuN ? cpuSum / cpuN : 0, scope: 'cluster' });
  out.push({ metric: 'cluster.mem.avg', value: memN ? memSum / memN : 0, scope: 'cluster' });

  // ── node.cpu.max + node.loadavg.per_core — per-node ─────────────────────
  for (const n of onlineNodes) {
    const name = n.node ?? n.id;
    if (n.cpu !== undefined) {
      out.push({ metric: 'node.cpu.max', value: n.cpu, scope: `node:${name}` });
    }
    const status = nodeStatuses[name];
    const raw = status?.loadavg?.[0];
    const load1 = raw ? Number.parseFloat(raw) : NaN;
    const cores = n.maxcpu ?? 0;
    if (Number.isFinite(load1) && cores > 0) {
      out.push({
        metric: 'node.loadavg.per_core',
        value: load1 / cores,
        scope: `node:${name}`,
      });
    }
  }

  // ── guests.failing.count — cluster scalar ───────────────────────────────
  const failing = guests.filter(
    (g) => g.status && g.status !== 'running' && g.status !== 'stopped',
  ).length;
  out.push({ metric: 'guests.failing.count', value: failing, scope: 'cluster' });

  return out;
}

// ─── Tick state machine ────────────────────────────────────────────────────
//
// Per (ruleId, scope) we remember the last tick's match result. A
// transition from "matched" to "not-matched" fires a resolve.
//
// Keyed by `ruleId|scope` so a rule with no scope and a scoped rule
// can both use this Map without clobbering each other.

declare global {

  var __nexusNotifPollLast: Map<string, boolean> | undefined;

  var __nexusNotifPollTimer: NodeJS.Timeout | undefined;
}

function lastMatchMap(): Map<string, boolean> {
  if (!globalThis.__nexusNotifPollLast) globalThis.__nexusNotifPollLast = new Map();
  return globalThis.__nexusNotifPollLast;
}

/**
 * One tick of the polling loop — computes metrics, emits events for
 * each metric reading, and fires resolve notifications for rules whose
 * predicates stopped matching. Exported so tests and an operator
 * "poll now" button can invoke it directly.
 */
export async function runTick(
  resources: readonly ClusterResourcePublic[],
  nodeStatuses: Record<string, NodeStatus | undefined>,
  _tasks: readonly PVETask[] = [],
  now: number = Date.now(),
): Promise<void> {
  const readings = computeMetrics(resources, nodeStatuses);
  const rules = await listRules();
  const seen = lastMatchMap();

  // Emit every reading — rule-matcher does the per-rule filter. Saves
  // us iterating rules × readings twice.
  for (const r of readings) {
    const ev: MetricEvent = {
      kind: 'metric.threshold.crossed',
      at: now,
      metric: r.metric,
      value: r.value,
      scope: r.scope,
    };
    emit(ev);
  }

  // Resolve-clear detection for metric-threshold rules only (pushed
  // events clear via the time-based sweep). A rule clears when its
  // predicate matched on last tick and doesn't match this tick.
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.match.eventKind !== 'metric.threshold.crossed') continue;

    // Find any reading that this rule would match right now.
    const nowMatches = readings.some((r) => {
      const ev: MetricEvent = {
        kind: 'metric.threshold.crossed',
        at: now,
        metric: r.metric,
        value: r.value,
        scope: r.scope,
      };
      return matchesEvent(rule.match, ev);
    });

    const key = `${rule.id}|${rule.match.scope ?? ''}`;
    const prev = seen.get(key) ?? false;
    seen.set(key, nowMatches);

    // prev=true, now=false → transition to cleared.
    if (prev && !nowMatches && rule.consecutiveFires > 0) {
      if (shouldFireResolve(rule)) {
        // Emit a synthetic resolved event so the dispatcher's usual
        // path handles the transport. The dispatcher recognises
        // `payload.__resolve=true` and sets `resolved: true` on the
        // outgoing payload.
        emit({
          kind: rule.match.eventKind,
          at: now,
          metric: rule.match.metric ?? '',
          value: 0,
          scope: rule.match.scope ?? 'cluster',
        });
      }
      await markRuleCleared(rule.id, now);
    }
  }

  // Mark fires for rules that only had time-based state — not this
  // source's job. The dispatcher's markRuleFired handles that on the
  // emit path above.
  void markRuleFired;
}

/**
 * Time-based sweep for pushed-event rules. Called on each tick.
 * Rules whose `lastFireAt` is older than 2× the last backoff slot
 * (effectively "we haven't heard anything for a while") are marked
 * cleared, fires a resolve if the policy permits.
 */
export async function sweepPushedClears(now: number = Date.now()): Promise<void> {
  const CLEAR_MULT = 2; // "2× the last cap" — matches the roadmap prose.
  const rules = await listRules();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.match.eventKind === 'metric.threshold.crossed') continue;
    if (rule.consecutiveFires === 0 || !rule.lastFireAt) continue;
    // Without a nextEligibleAt we can't determine the cap; assume 60 min.
    const windowMs = Math.max(
      60 * 60_000,
      (rule.nextEligibleAt ?? now) - (rule.lastFireAt ?? now),
    ) * CLEAR_MULT;
    if (now - rule.lastFireAt < windowMs) continue;

    if (shouldFireResolve(rule)) {
      emit({
        kind: rule.match.eventKind as Exclude<
          MetricEvent['kind'] | 'pve.renewal.failed',
          'metric.threshold.crossed'
        >,
        at: now,
        payload: { __resolve: true },
      } as never);
    }
    await markRuleCleared(rule.id, now);
  }
}

// ─── Timer lifecycle ───────────────────────────────────────────────────────

export interface PollSourceOptions {
  tickMs?: number;
  fetchState: () => Promise<{
    resources: ClusterResourcePublic[];
    nodeStatuses: Record<string, NodeStatus | undefined>;
    tasks: PVETask[];
  }>;
}

export function startPollSource(opts: PollSourceOptions): () => void {
  const prev = globalThis.__nexusNotifPollTimer;
  if (prev) clearInterval(prev);

  const interval = opts.tickMs ?? DEFAULT_TICK_MS;
  const timer = setInterval(() => {
    void (async () => {
      try {
        const { resources, nodeStatuses, tasks } = await opts.fetchState();
        await runTick(resources, nodeStatuses, tasks);
        await sweepPushedClears();
      } catch (err) {
        console.error(
          '[nexus event=notification_poll_failed] reason=%s',
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, interval);
  timer.unref?.();
  globalThis.__nexusNotifPollTimer = timer;

  return () => {
    if (globalThis.__nexusNotifPollTimer === timer) {
      clearInterval(timer);
      globalThis.__nexusNotifPollTimer = undefined;
    }
  };
}

/** Test helpers. */
export const __testing = {
  clearLastMatchMap(): void {
    globalThis.__nexusNotifPollLast?.clear();
  },
} as const;

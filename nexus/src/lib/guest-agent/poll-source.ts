/**
 * Guest-agent poll source (5.2).
 *
 * Separate from the notifications metric poll so agent RPCs (which can
 * block the QMP ring buffer) don't slow down the metrics tick. Lives on
 * its own 60s cadence by default.
 *
 * Each tick:
 *   1. Enumerate running QEMU guests with `agent=1` in config.
 *      (LXC deferred — see design note in CLAUDE.md 5.2.)
 *   2. Probe each (bounded parallelism) → GuestProbe.
 *   3. For each probe:
 *        - reachable + fs over threshold (once) → emit guest.disk.filling
 *        - unreachable N consecutive ticks → emit guest.agent.unreachable
 *      State for dedup + consecutive-count lives in a module-local map,
 *      rebuilt on process restart (events are the durable record).
 *   4. Write the snapshot for UI consumers.
 */

import { emit } from '../notifications/event-bus.ts';
import { probeGuest } from './probe.ts';
import { setSnapshot } from './snapshot.ts';
import type { DiskPressure, GuestProbe } from './types.ts';
import type { ServiceAccountSession } from '../service-account/types.ts';

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_PRESSURE_THRESHOLD = 0.85;
const DEFAULT_UNREACHABLE_THRESHOLD = 3;
const PROBE_CONCURRENCY = 4;
/** Run the services probe every Nth tick. Kept lightweight so the default
 *  60s cadence only runs `systemctl list-units` every 3 minutes per guest. */
const SERVICES_PROBE_EVERY_N_TICKS = 3;

let tickCounter = 0;

/** One entry in the fleet the poll source iterates over. */
export interface GuestTarget {
  node: string;
  vmid: number;
}

/** Per-guest state tracked between ticks. Keyed by `${node}/${vmid}`. */
interface GuestTickState {
  consecutiveUnreachable: number;
  /** Set of mountpoints currently above threshold — for edge detection. */
  fillingMounts: Set<string>;
  /** True once we've already fired `guest.agent.unreachable` this run. */
  unreachableFired: boolean;
  /** Set of unit names currently failing — for edge detection. */
  failedUnits: Set<string>;
  /** First-observed wall-time per unit — persisted across ticks so a
   *  resolved-then-returned unit gets its original timestamp back if it's
   *  still in `firstObserved`. Entries cleared on resolve. */
  firstObserved: Map<string, number>;
}

const tickState = new Map<string, GuestTickState>();

function keyOf(node: string, vmid: number): string {
  return `${node}/${vmid}`;
}

function ensureState(k: string): GuestTickState {
  let s = tickState.get(k);
  if (!s) {
    s = {
      consecutiveUnreachable: 0,
      fillingMounts: new Set(),
      unreachableFired: false,
      failedUnits: new Set(),
      firstObserved: new Map(),
    };
    tickState.set(k, s);
  }
  return s;
}

export interface PollSourceOptions {
  tickMs?: number;
  /** Usage fraction [0..1] above which a mount is considered "filling". */
  pressureThreshold?: number;
  /** Consecutive failed probes before we fire `guest.agent.unreachable`. */
  unreachableThreshold?: number;
  /** Enumerate guests to probe. Returns the cluster-wide fleet each tick
   *  so config changes (agent toggled off, new VMs) are picked up. */
  fetchGuests: () => Promise<GuestTarget[]>;
  /** PVE session used for every probe. The service-account session
   *  (API token) — background probes can't use a user ticket since
   *  tickets expire and aren't bound to the boot lifecycle. */
  getSession: () => ServiceAccountSession | null;
}

/**
 * Probe the whole fleet with bounded concurrency. Returns the probes
 * in the same order as the input (stable for snapshot diffing).
 */
async function probeFleet(
  guests: GuestTarget[],
  session: ServiceAccountSession,
  probeServices: boolean,
): Promise<GuestProbe[]> {
  const out: GuestProbe[] = new Array(guests.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const idx = cursor++;
      if (idx >= guests.length) return;
      const g = guests[idx];
      out[idx] = await probeGuest({ session, node: g.node, vmid: g.vmid, probeServices });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, guests.length) }, () => worker()),
  );
  return out;
}

/**
 * Process one tick's probes: emit events, update tick state, compute
 * the pressure roll-up for the snapshot. Pure w.r.t. I/O except for
 * calling `emit()` — the caller owns fetching + persisting the snapshot.
 */
export function processProbes(
  probes: GuestProbe[],
  opts: { pressureThreshold: number; unreachableThreshold: number; now: number },
): DiskPressure[] {
  const pressures: DiskPressure[] = [];
  const seenKeys = new Set<string>();

  for (const probe of probes) {
    const k = keyOf(probe.node, probe.vmid);
    seenKeys.add(k);
    const state = ensureState(k);

    if (!probe.reachable) {
      state.consecutiveUnreachable += 1;
      if (
        !state.unreachableFired &&
        state.consecutiveUnreachable >= opts.unreachableThreshold
      ) {
        emit({
          kind: 'guest.agent.unreachable',
          at: opts.now,
          payload: {
            vmid: probe.vmid,
            node: probe.node,
            consecutiveFailures: state.consecutiveUnreachable,
            reason: probe.reason ?? 'unknown',
          },
        });
        state.unreachableFired = true;
      }
      continue;
    }

    // Reachable — reset unreachable tracking so a recovered guest can
    // fire again the next time it drops off.
    state.consecutiveUnreachable = 0;
    state.unreachableFired = false;

    const filesystems = probe.filesystems ?? [];
    const nowFilling = new Set<string>();
    for (const fs of filesystems) {
      const usedPct = fs.usedBytes / fs.totalBytes;
      if (usedPct >= opts.pressureThreshold) {
        nowFilling.add(fs.mountpoint);
        pressures.push({
          vmid: probe.vmid,
          node: probe.node,
          mountpoint: fs.mountpoint,
          usedPct,
          totalBytes: fs.totalBytes,
          usedBytes: fs.usedBytes,
        });
        // Edge-trigger: only fire when this mount crosses the threshold,
        // not every tick while it stays there. Rule-engine backoff would
        // dedupe downstream anyway, but avoiding the emit keeps the event
        // bus quiet.
        if (!state.fillingMounts.has(fs.mountpoint)) {
          emit({
            kind: 'guest.disk.filling',
            at: opts.now,
            payload: {
              vmid: probe.vmid,
              node: probe.node,
              mountpoint: fs.mountpoint,
              usedPct: Number(usedPct.toFixed(3)),
              totalBytes: fs.totalBytes,
              usedBytes: fs.usedBytes,
            },
          });
        }
      }
    }
    state.fillingMounts = nowFilling;

    // Services probe — off-ticks leave `failedServices` undefined so we
    // skip the edge/resolve bookkeeping entirely (otherwise every off-tick
    // would look like "all units cleared" and emit spurious resolves).
    if (probe.failedServices !== undefined) {
      const nowFailing = new Set<string>();
      for (const svc of probe.failedServices) {
        nowFailing.add(svc.unit);
        if (!state.failedUnits.has(svc.unit)) {
          // Edge: empty→present. Record (or reuse) observation time and emit.
          const since = state.firstObserved.get(svc.unit) ?? opts.now;
          state.firstObserved.set(svc.unit, since);
          emit({
            kind: 'guest.service.failed',
            at: opts.now,
            payload: {
              vmid: probe.vmid,
              node: probe.node,
              unit: svc.unit,
              description: svc.description,
              since,
            },
          });
        }
      }
      // Resolve: units that left the failing set since last tick.
      for (const prev of state.failedUnits) {
        if (!nowFailing.has(prev)) {
          state.firstObserved.delete(prev);
          emit({
            kind: 'guest.service.failed',
            at: opts.now,
            payload: {
              vmid: probe.vmid,
              node: probe.node,
              unit: prev,
              description: '',
              since: 0,
            },
            __resolve: true,
          });
        }
      }
      state.failedUnits = nowFailing;
    }
  }

  // GC state for guests that dropped out of the fleet (deleted, agent
  // turned off, migrated away to a node we don't probe). Prevents
  // unbounded growth.
  for (const existing of tickState.keys()) {
    if (!seenKeys.has(existing)) tickState.delete(existing);
  }

  return pressures;
}

export async function runTick(opts: PollSourceOptions): Promise<void> {
  const session = opts.getSession();
  if (!session) return; // Boot in progress; skip silently.
  // Decide BEFORE the fetch so an empty-fleet tick still advances the
  // counter — keeps the cadence stable regardless of guest churn.
  const probeServices = tickCounter % SERVICES_PROBE_EVERY_N_TICKS === 0;
  try {
    const guests = await opts.fetchGuests();
    const now = Date.now();
    if (guests.length === 0) {
      setSnapshot({ updatedAt: now, probes: [], pressures: [] });
      return;
    }
    const probes = await probeFleet(guests, session, probeServices);
    const pressures = processProbes(probes, {
      pressureThreshold: opts.pressureThreshold ?? DEFAULT_PRESSURE_THRESHOLD,
      unreachableThreshold: opts.unreachableThreshold ?? DEFAULT_UNREACHABLE_THRESHOLD,
      now,
    });
    setSnapshot({ updatedAt: now, probes, pressures });
  } finally {
    tickCounter += 1;
  }
}

// ─── Timer lifecycle ───────────────────────────────────────────────────────

declare global {
  var __nexusGuestPollTimer: NodeJS.Timeout | undefined;
}

export function startPollSource(opts: PollSourceOptions): () => void {
  const prev = globalThis.__nexusGuestPollTimer;
  if (prev) clearInterval(prev);

  const interval = opts.tickMs ?? DEFAULT_TICK_MS;
  const timer = setInterval(() => {
    void (async () => {
      try {
        await runTick(opts);
      } catch (err) {
        console.error(
          '[nexus event=guest_poll_failed] reason=%s',
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, interval);
  timer.unref?.();
  globalThis.__nexusGuestPollTimer = timer;

  return () => {
    if (globalThis.__nexusGuestPollTimer === timer) {
      clearInterval(timer);
      globalThis.__nexusGuestPollTimer = undefined;
    }
  };
}

/** Test-only state reset. */
export function __resetTickState(): void {
  tickState.clear();
  tickCounter = 0;
}

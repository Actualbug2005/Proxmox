/**
 * Cluster-wide guest-agent snapshot — in-memory, last-tick state.
 *
 * The poll source refreshes this every 60s (configurable). The bento
 * widget and any drawer that wants a cluster roll-up reads from here
 * instead of re-probing every guest on page load.
 *
 * Not persisted: if the process restarts we just wait for the next
 * tick. The events dispatched by the poll source are the durable
 * record; this snapshot is purely for display caching.
 */

import type { DiskPressure, GuestProbe } from './types.ts';

export interface GuestSnapshot {
  updatedAt: number;
  probes: GuestProbe[];
  /** Flattened, threshold-filtered pressure rows for the bento widget. */
  pressures: DiskPressure[];
}

let current: GuestSnapshot = {
  updatedAt: 0,
  probes: [],
  pressures: [],
};

export function getSnapshot(): GuestSnapshot {
  return current;
}

export function setSnapshot(snap: GuestSnapshot): void {
  current = snap;
}

/** Test-only reset hook. Keeps the module state predictable across runs. */
export function __resetForTests(): void {
  current = { updatedAt: 0, probes: [], pressures: [] };
}

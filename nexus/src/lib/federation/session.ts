/**
 * In-memory federation session.
 *
 * Holds the decrypted cluster list + probe states that proxy-path
 * lookups hit on every request. `loadFederationAtBoot()` primes it
 * from the store; `reloadFederation()` re-primes after add/remove/
 * rotate API mutations.
 *
 * `getClusterProbeState(id)` is consulted by the proxy to pick the
 * sticky active endpoint. When no probe has run yet (or the cluster
 * is unreachable) the proxy falls back to endpoints[0].
 */
import type { RegisteredCluster, ClusterProbeState } from './types.ts';
import { listClusters } from './store.ts';

let clusters: RegisteredCluster[] = [];
const probeStates = new Map<string, ClusterProbeState>();
let reloadInFlight: Promise<void> | null = null;

async function doReload(): Promise<void> {
  clusters = await listClusters();
}

export async function loadFederationAtBoot(): Promise<void> {
  await reloadFederation();
}

export async function reloadFederation(): Promise<void> {
  if (reloadInFlight) {
    await reloadInFlight;
    return;
  }
  reloadInFlight = doReload().finally(() => {
    reloadInFlight = null;
  });
  await reloadInFlight;
}

export function resolveRegisteredCluster(id: string): RegisteredCluster | null {
  return clusters.find((c) => c.id === id) ?? null;
}

export function getClusterProbeState(id: string): ClusterProbeState | null {
  return probeStates.get(id) ?? null;
}

/** Exported only so the probe runner can write into the shared map. */
export function __getProbeStates(): Map<string, ClusterProbeState> {
  return probeStates;
}

/** Exported only so the probe runner can read the current registered set. */
export function __getClusters(): RegisteredCluster[] {
  return clusters;
}

/** Reset module state — test-only utility. Prod callers don't need this. */
export function __resetForTests(): void {
  clusters = [];
  probeStates.clear();
  reloadInFlight = null;
}

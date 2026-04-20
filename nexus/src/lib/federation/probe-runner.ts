/**
 * probe-runner.ts — periodic fan-out probe across all registered clusters.
 *
 * Tick cadence: 60s (wired from server.ts). A single in-flight lock
 * prevents overlapping ticks from piling up on slow networks.
 *
 * The probeOne seam exists for tests; the runtime wiring in server.ts
 * injects a closure that calls probeCluster with pveFetch + Date.now
 * and the current sticky endpoint.
 */
import type { ClusterProbeState, RegisteredCluster } from './types.ts';

export interface RunTickOptions {
  listClusters: () => Promise<RegisteredCluster[]>;
  probeOne: (
    cluster: RegisteredCluster,
    ctx: { lastActiveEndpoint?: string },
  ) => Promise<ClusterProbeState>;
  state: Map<string, ClusterProbeState>;
}

let running = false;

export async function runProbeTick(opts: RunTickOptions): Promise<void> {
  if (running) return;
  running = true;
  try {
    const registered = await opts.listClusters();
    const registeredIds = new Set(registered.map((c) => c.id));
    // Remove states for clusters that no longer exist.
    for (const id of opts.state.keys()) {
      if (!registeredIds.has(id)) opts.state.delete(id);
    }
    const results = await Promise.all(
      registered.map(async (c) => {
        const prev = opts.state.get(c.id);
        try {
          return await opts.probeOne(c, {
            lastActiveEndpoint: prev?.activeEndpoint ?? undefined,
          });
        } catch (err) {
          // One cluster throwing must not break the rest; record as
          // unreachable with the error message so the UI surfaces it.
          return {
            clusterId: c.id,
            reachable: false,
            activeEndpoint: prev?.activeEndpoint ?? null,
            latencyMs: null,
            pveVersion: null,
            quorate: null,
            lastProbedAt: Date.now(),
            lastError: err instanceof Error ? err.message : String(err),
          } satisfies ClusterProbeState;
        }
      }),
    );
    for (const r of results) opts.state.set(r.clusterId, r);
  } finally {
    running = false;
  }
}

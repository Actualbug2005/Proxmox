/**
 * probe.ts — per-cluster reachability + quorum probe (pure function).
 *
 * Parameterised on fetchFn + now so tests don't need module mocks.
 * Production wires in pveFetch (scoped undici Agent for self-signed
 * certs) and Date.now via probe-runner.ts.
 *
 * Sticky-failover: if the caller passes lastActiveEndpoint, that one
 * is tried first — "last known good" preserved across ticks, even
 * after a total outage window.
 */
import type { ClusterProbeState, RegisteredCluster } from './types.ts';

/** Per-HTTP-request timeout. Each endpoint attempt makes two requests
 *  (version + cluster/status), so each endpoint gets up to ~10s total. */
const PROBE_TIMEOUT_MS = 5000;

interface ProbeOptions {
  fetchFn: typeof fetch;
  now: () => number;
  /** Most-recently-successful endpoint; probed first on next tick. */
  lastActiveEndpoint?: string;
}

function orderEndpoints(cluster: RegisteredCluster, active?: string): string[] {
  if (active && cluster.endpoints.includes(active)) {
    return [active, ...cluster.endpoints.filter((e) => e !== active)];
  }
  return [...cluster.endpoints];
}

export async function probeCluster(
  cluster: RegisteredCluster,
  opts: ProbeOptions,
): Promise<ClusterProbeState> {
  const ordered = orderEndpoints(cluster, opts.lastActiveEndpoint);
  const headers = {
    Authorization: `PVEAPIToken=${cluster.tokenId}=${cluster.tokenSecret}`,
    Accept: 'application/json',
  };

  let lastError: string | null = null;

  for (const endpoint of ordered) {
    const t0 = opts.now();
    try {
      const versionUrl = `${endpoint}/api2/json/version`;
      const res = await opts.fetchFn(versionUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastError = `version ${res.status}`;
        continue;
      }
      const body = (await res.json()) as { data?: { version?: string } };
      const pveVersion = body.data?.version ?? null;
      const latencyMs = opts.now() - t0;

      // Quorum probe is best-effort; a failure here doesn't invalidate the
      // reachable+pveVersion success we already have.
      let quorate: boolean | null = null;
      try {
        const statusUrl = `${endpoint}/api2/json/cluster/status`;
        const sres = await opts.fetchFn(statusUrl, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (sres.ok) {
          const sbody = (await sres.json()) as {
            data?: Array<{ type: string; online?: 0 | 1; quorate?: 0 | 1 }>;
          };
          const entries = sbody.data ?? [];
          // Prefer PVE's own `quorate` flag on the type:'cluster' entry —
          // Corosync's view honours two_node, expected_votes, etc., which a
          // naive majority heuristic misses. Fall back to strict majority
          // of the type:'node' entries only if the cluster entry is absent.
          const clusterEntry = entries.find((e) => e.type === 'cluster');
          if (clusterEntry?.quorate !== undefined) {
            quorate = clusterEntry.quorate === 1;
          } else {
            const nodes = entries.filter((e) => e.type === 'node');
            if (nodes.length > 0) {
              const online = nodes.filter((n) => n.online === 1).length;
              quorate = online * 2 > nodes.length; // strict majority
            }
          }
        }
      } catch {
        quorate = null;
      }

      return {
        clusterId: cluster.id,
        reachable: true,
        activeEndpoint: endpoint,
        latencyMs,
        pveVersion,
        quorate,
        lastProbedAt: opts.now(),
        lastError: null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    clusterId: cluster.id,
    reachable: false,
    activeEndpoint: null,
    latencyMs: null,
    pveVersion: null,
    quorate: null,
    lastProbedAt: opts.now(),
    lastError,
  };
}

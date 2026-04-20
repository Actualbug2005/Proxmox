/**
 * Federation registry types (spec §Data-types-and-persistence).
 *
 * RegisteredCluster holds PVE API token creds for a remote cluster;
 * ClusterProbeState is in-memory observational data populated by the
 * probe runner. CreateClusterInput / RotateCredentialsInput are the
 * API request bodies.
 */

export interface RegisteredCluster {
  /** Slug-cased id, 1-32 chars. Used in ?cluster=<id>. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Ordered endpoint list for failover. https:// only. */
  endpoints: string[];
  /** Reserved for future ticket-mode; v0.34.0 always writes 'token'. */
  authMode: 'token';
  /** PVE API token id: user@realm!tokenname. */
  tokenId: string;
  /** UUID secret PVE issued. Never logged, never returned to client. */
  tokenSecret: string;
  savedAt: number;
  rotatedAt: number;
}

export interface ClusterProbeState {
  clusterId: string;
  reachable: boolean;
  activeEndpoint: string | null;
  latencyMs: number | null;
  pveVersion: string | null;
  /** From /cluster/status: true if >50% of nodes online; null if not probed yet. */
  quorate: boolean | null;
  lastProbedAt: number;
  lastError: string | null;
}

export interface CreateClusterInput {
  id: string;
  name: string;
  endpoints: string[];
  tokenId: string;
  tokenSecret: string;
}

export interface RotateCredentialsInput {
  tokenId: string;
  tokenSecret: string;
}

/** On-disk envelope; framing version is checked on load and rejected on mismatch. */
export interface FederationFile {
  version: 1;
  clusters: RegisteredCluster[];
}

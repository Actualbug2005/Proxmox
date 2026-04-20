/**
 * Response-shape serializer for federation API routes.
 *
 * Single boundary point that decides what leaves the server. Any field
 * added to RegisteredCluster has to be explicitly added here — tokenSecret
 * MUST remain elided. Lives in its own module so both /api/federation
 * route files share the same shape (prevents drift).
 */
import { getClusterProbeState } from './session.ts';
import type { ClusterProbeState, RegisteredCluster } from './types.ts';

export interface RedactedCluster {
  id: string;
  name: string;
  endpoints: string[];
  authMode: 'token';
  tokenId: string;
  savedAt: number;
  rotatedAt: number;
  probe: ClusterProbeState | null;
}

export function redactCluster(c: RegisteredCluster): RedactedCluster {
  return {
    id: c.id,
    name: c.name,
    endpoints: c.endpoints,
    authMode: c.authMode,
    tokenId: c.tokenId,
    savedAt: c.savedAt,
    rotatedAt: c.rotatedAt,
    probe: getClusterProbeState(c.id),
    // tokenSecret is intentionally omitted.
  };
}

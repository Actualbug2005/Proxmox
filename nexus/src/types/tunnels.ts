/**
 * Shared types for the tunnel-provider probe API.
 *
 * Mirrored DTOs are imported by both the route at
 * `src/app/api/tunnels/status/route.ts` and the certificates page that
 * renders the status, so the two cannot drift.
 */

export type TunnelProviderId = 'cloudflared' | 'ngrok';

export type TunnelStatus =
  | 'not-installed'
  | 'not-configured'
  | 'stopped'
  | 'active'
  | 'unknown';

export interface TunnelStatusResponse {
  providers: Partial<Record<TunnelProviderId, TunnelStatus>>;
}

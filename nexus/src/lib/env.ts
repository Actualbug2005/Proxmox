/**
 * Environment-scoped fail-closed helpers. Safe to import from both the
 * Edge-runtime proxy and the Node.js API routes — must not pull in any
 * Node-only APIs (no next/headers, no node:crypto).
 *
 * ─── Environment variables ──────────────────────────────────────────────────
 *
 *   JWT_SECRET   (required, >= 16 chars)
 *     HMAC key for the CSRF token derivation. The app refuses to serve
 *     requests if this is unset — see getJwtSecret().
 *
 *   REDIS_URL    (optional, e.g. redis://localhost:6379/0)
 *     If set, lib/session-store.ts persists sessions in Redis with a native
 *     8h EX TTL. Required for multi-replica deployments and for sessions
 *     that survive process restarts. If unset, sessions live in an in-memory
 *     Map (single-node / dev fallback).
 *
 *   PROXMOX_HOST (optional, default: 'localhost')
 *     Hostname of the PVE API. Used by the proxy and login routes.
 *
 *   NODE_ENV     (Next.js managed)
 *     'production' enables Secure cookies; otherwise cookies allow plain HTTP.
 */
let cached: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (cached) return cached;
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      'JWT_SECRET is required (minimum 16 chars). Refusing to start with an insecure default.',
    );
  }
  cached = new TextEncoder().encode(raw);
  return cached;
}

/**
 * Scoped fetch for the Proxmox VE HTTPS endpoint (self-signed cert).
 *
 * PVE's `pveproxy` on :8006 ships with a self-signed certificate by default.
 * Historically every route that called PVE set
 *   process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
 * at module-load time. That flag is **process-global** — once set, every
 * outbound fetch in the Node runtime silently accepts any cert (valid,
 * expired, wrong-CN, MITM'd). That is a critical TLS-verification bypass
 * that leaks to third-party calls (GitHub community-scripts, Let's
 * Encrypt, Cloudflare webhooks, etc).
 *
 * This module replaces the global mutation with a **scoped undici Agent**
 * that's only used for calls to `https://<PROXMOX_HOST>:8006`. Every other
 * outbound fetch in the app continues to verify certs normally.
 *
 * Usage:
 *   import { pveFetch } from '@/lib/pve-fetch';
 *   const res = await pveFetch(`https://${host}:8006/api2/json/...`, { … });
 *
 * All existing `fetch(...)` call sites that target PVE should migrate to
 * `pveFetch(...)`. Non-PVE fetches (community-scripts, etc.) stay on the
 * global `fetch` and enjoy normal TLS verification.
 *
 * Future hardening: pin PVE's self-signed cert fingerprint via
 * `connect: { checkServerIdentity: … }` on the Agent, so even a stolen
 * PVE private key can't MITM without also matching the recorded
 * fingerprint.
 */

import {
  Agent,
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from 'undici';

import type { ServiceAccountSession } from './service-account/types.ts';

// Single shared Agent — undici pools connections per Agent instance, so one
// Agent for the whole app keeps connection reuse working (no per-request
// TCP+TLS handshake overhead).
const pveAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
  // Keep connections alive between requests for latency.
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
});

// Active dispatcher used by pveFetchWithToken when the caller doesn't supply
// its own. In production this stays pinned to `pveAgent`. The exported
// setter below lets the test suite swap in an undici MockAgent so requests
// from code paths that don't expose an init override (e.g. the probe invoked
// inside `reloadServiceAccount`) can be intercepted without stubbing the
// global `fetch`.
let currentPveDispatcher: Dispatcher = pveAgent;

/**
 * Test-only hook: replace the dispatcher used by {@link pveFetchWithToken}.
 * Production code never calls this; it exists so the test suite can route
 * pveFetchWithToken through undici's MockAgent without monkey-patching
 * `globalThis.fetch`. Pass `null` to restore the default scoped `pveAgent`.
 */
export function __setPveDispatcherForTests(d: Dispatcher | null): void {
  currentPveDispatcher = d ?? pveAgent;
}

/**
 * Scoped fetch with TLS verification disabled — use ONLY for calls to
 * the local Proxmox host. Returns an undici Response, which is structurally
 * compatible with the standard fetch Response for all usage in this codebase
 * (`res.ok`, `res.status`, `res.statusText`, `res.json()`, `res.text()`,
 * `res.headers.get()`, `res.body`).
 *
 * If a caller relies on a web-platform-specific Response method not covered
 * by undici's Response, we'll encounter a type error at the call site and
 * can address it explicitly.
 */
export function pveFetch(
  url: string | URL,
  init?: UndiciRequestInit,
): ReturnType<typeof undiciFetch> {
  return undiciFetch(url, {
    ...init,
    dispatcher: pveAgent,
  });
}

/**
 * Service-account variant of {@link pveFetch}. Sends PVE API-token auth via
 * a single `Authorization: PVEAPIToken=<tokenId>=<secret>` header — no
 * ticket cookie, no CSRF header (API tokens don't need CSRF since the
 * secret itself is the credential).
 *
 * Goes through undici's fetch (same as {@link pveFetch}) so the shared
 * `pveAgent` dispatcher is honoured reliably across every Node version —
 * Node's global fetch silently broke `dispatcher` support on some 22.x
 * minors and surfaced as `UND_ERR_INVALID_ARG: invalid onRequestStart
 * method` against PVE.
 */
export function pveFetchWithToken(
  session: ServiceAccountSession,
  url: string | URL,
  init?: UndiciRequestInit,
): ReturnType<typeof undiciFetch> {
  // Build a clean init object. Caller may override the dispatcher (tests
  // inject a MockAgent/Pool); production callers leave it unset so the
  // shared pveAgent is used.
  const merged = { dispatcher: currentPveDispatcher, ...init };
  const authValue = `PVEAPIToken=${session.tokenId}=${session.secret}`;
  if (merged.headers instanceof Array) {
    merged.headers = [...merged.headers, ['Authorization', authValue]];
  } else if (merged.headers && typeof merged.headers === 'object') {
    merged.headers = { ...(merged.headers as Record<string, string>), Authorization: authValue };
  } else {
    merged.headers = { Authorization: authValue };
  }
  return undiciFetch(url, merged);
}

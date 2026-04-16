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

import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

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

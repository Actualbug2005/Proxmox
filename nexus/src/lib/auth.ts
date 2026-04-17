/**
 * Auth utilities — server-side only.
 *
 * The PVE ticket and CSRFPreventionToken are kept server-side in the session
 * store; the browser only holds an opaque random sessionId. This stops anyone
 * with LAN-sniffer access or dev-tools from lifting root-equivalent PVE
 * credentials out of the cookie.
 */
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { PVEAuthSession, PVETicketResponse } from '@/types/proxmox';
import {
  putSession,
  getStoredSession,
  deleteStoredSession,
  SESSION_TTL_MS,
} from '@/lib/session-store';
import { deriveCsrfToken, CSRF_COOKIE } from '@/lib/csrf';
import { pveFetch } from '@/lib/pve-fetch';

export const SESSION_COOKIE = 'nexus_session';

// Re-exported for convenience; canonical definition lives in lib/env.ts so
// the Edge-runtime proxy can import it without pulling in next/headers.
export { getJwtSecret } from '@/lib/env';

// ─── PVE Ticket Auth ─────────────────────────────────────────────────────────

export async function acquirePVETicket(
  host: string,
  username: string,
  password: string,
  realm: string = 'pam',
): Promise<PVETicketResponse> {
  const fullUser = username.includes('@') ? username : `${username}@${realm}`;

  const res = await pveFetch(`https://${host}:8006/api2/json/access/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: fullUser, password }).toString(),
  });

  if (!res.ok) {
    throw new Error(`PVE auth failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: PVETicketResponse };
  if (!json.data?.ticket) {
    throw new Error('Invalid credentials');
  }
  return json.data;
}

// ─── PVE Ticket Refresh ─────────────────────────────────────────────────────

/**
 * Age in ms at which `refreshPVESessionIfStale` triggers a re-auth. PVE
 * tickets are valid for ~2h; refreshing at 90m gives a 30m safety margin
 * before pveproxy starts 401ing.
 */
export const PVE_TICKET_REFRESH_AFTER_MS = 90 * 60 * 1000;

/**
 * Re-authenticate with PVE using the existing ticket as the password. PVE
 * accepts this as a renewal and returns a fresh ticket + CSRF token — no
 * user credentials required. See pveproxy source:
 *   https://pve.proxmox.com/wiki/Proxmox_VE_API#Authentication (ticket renewal)
 */
async function renewPVETicket(
  session: PVEAuthSession,
): Promise<PVETicketResponse> {
  const res = await pveFetch(
    `https://${session.proxmoxHost}:8006/api2/json/access/ticket`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: session.username,
        password: session.ticket,
      }).toString(),
    },
  );
  if (!res.ok) {
    throw new Error(`PVE ticket renewal failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: PVETicketResponse };
  if (!json.data?.ticket) throw new Error('Ticket renewal returned no ticket');
  return json.data;
}

/**
 * Proactively refresh the PVE ticket if it's older than PVE_TICKET_REFRESH_AFTER_MS.
 * Called from the proxy BEFORE forwarding any request — so every authenticated
 * call past the 90-minute mark rides a fresh ticket.
 *
 * On success, mutates the stored session with the new ticket + CSRF token + stamp.
 * On failure, logs and returns the stale session unchanged (caller will see a
 * 401 from PVE on the next request and handle re-login via the proxy's existing
 * 401 → clear-cookies branch).
 *
 * Returns the possibly-refreshed session so the caller can use the new ticket
 * in the current request without a second store read.
 */
export async function refreshPVESessionIfStale(
  sessionId: string,
  session: PVEAuthSession,
): Promise<PVEAuthSession> {
  const age = Date.now() - session.ticketIssuedAt;
  if (age < PVE_TICKET_REFRESH_AFTER_MS) return session;

  try {
    const fresh = await renewPVETicket(session);
    const updated: PVEAuthSession = {
      ...session,
      ticket: fresh.ticket,
      csrfToken: fresh.CSRFPreventionToken,
      ticketIssuedAt: Date.now(),
    };
    await putSession(sessionId, updated);
    return updated;
  } catch (err) {
    console.error('[refreshPVESessionIfStale] renewal failed:', err);
    return session;
  }
}

// ─── Session id ─────────────────────────────────────────────────────────────

function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

// ─── Cookie helpers ─────────────────────────────────────────────────────────

/**
 * Create a server-side session, set the sessionId cookie + CSRF companion
 * cookie, and return the CSRF token so the login response can include it.
 */
export async function startSession(
  data: PVEAuthSession,
): Promise<{ sessionId: string; csrfToken: string }> {
  const cookieStore = await cookies();

  // M2 — session rotation. If the client already had a nexus_session cookie
  // (e.g. from a previous login, a planted cookie in a fixation attack, or a
  // pre-auth anonymous session), invalidate that sessionId in the store
  // BEFORE issuing the new one. The browser will then only hold the fresh
  // sessionId we set below, and any stolen-or-planted old ID can no longer
  // be used to look up a valid session.
  const previousSessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (previousSessionId) {
    try {
      await deleteStoredSession(previousSessionId);
    } catch {
      // Best-effort: a store error shouldn't block a legitimate login. The
      // old session will expire via TTL regardless.
    }
  }

  const sessionId = newSessionId();
  await putSession(sessionId, data);
  const csrfToken = deriveCsrfToken(sessionId);

  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  // Secure flag policy:
  //   production + default     → secure: true   (HTTPS behind ingress)
  //   production + override    → secure: false  (explicit LAN-HTTP opt-in)
  //   development              → secure: false  (localhost dev)
  //
  // NEXUS_SECURE_COOKIES=false is an escape hatch for operators who
  // genuinely serve Nexus over HTTP on a trusted LAN. Default is safe:
  // HTTPS-terminating ingress (Caddy/nginx/Traefik) proxies to this
  // Node process via X-Forwarded-Proto=https, and Chrome honours Secure
  // cookies on such connections correctly.
  const secureCookie =
    process.env.NEXUS_SECURE_COOKIES === 'false'
      ? false
      : process.env.NODE_ENV === 'production';

  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'strict',
    maxAge,
    path: '/',
  });
  // Companion CSRF cookie: NOT httpOnly so the browser JS can read it and
  // echo it in the X-Nexus-CSRF header (double-submit pattern).
  cookieStore.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: secureCookie,
    sameSite: 'strict',
    maxAge,
    path: '/',
  });

  return { sessionId, csrfToken };
}

export async function getSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

/** Full session object (including PVE ticket) from the server-side store. */
export async function getSession(): Promise<PVEAuthSession | null> {
  const sessionId = await getSessionId();
  if (!sessionId) return null;
  return await getStoredSession(sessionId);
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const sid = cookieStore.get(SESSION_COOKIE)?.value;
  if (sid) await deleteStoredSession(sid);
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(CSRF_COOKIE);
}

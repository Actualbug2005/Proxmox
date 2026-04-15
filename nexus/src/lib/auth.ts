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

  const res = await fetch(`https://${host}:8006/api2/json/access/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: fullUser, password }).toString(),
  });

  if (!res.ok) {
    throw new Error(`PVE auth failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.data?.ticket) {
    throw new Error('Invalid credentials');
  }
  return json.data as PVETicketResponse;
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
  const sessionId = newSessionId();
  await putSession(sessionId, data);
  const csrfToken = deriveCsrfToken(sessionId);

  const isProd = process.env.NODE_ENV === 'production';
  const cookieStore = await cookies();
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge,
    path: '/',
  });
  // Companion CSRF cookie: NOT httpOnly so the browser JS can read it and
  // echo it in the X-Nexus-CSRF header (double-submit pattern).
  cookieStore.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: isProd,
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

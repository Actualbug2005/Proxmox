/**
 * Auth utilities — server-side only
 * Handles PVE ticket acquisition, JWT session encoding, and cookie management.
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { PVEAuthSession, PVETicketResponse } from '@/types/proxmox';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'nexus-dev-secret-change-in-production',
);
const SESSION_COOKIE = 'nexus_session';
const MAX_AGE = 60 * 60 * 8; // 8 hours

// ─── PVE Ticket Auth ──────────────────────────────────────────────────────────

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
    // PVE uses self-signed certs — NODE_TLS_REJECT_UNAUTHORIZED=0 handles this at process level
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

// ─── JWT Session ──────────────────────────────────────────────────────────────

export async function createSession(session: PVEAuthSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(JWT_SECRET);
}

export async function verifySession(token: string): Promise<PVEAuthSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as PVEAuthSession;
  } catch {
    return null;
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export async function setSessionCookie(session: PVEAuthSession): Promise<void> {
  const token = await createSession(session);
  const cookieStore = await cookies();
  // Don't force Secure flag — app runs over plain HTTP on the Proxmox host.
  // Secure cookies over HTTP are rejected by Chrome; Safari is more lenient.
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  });
}

export async function getSession(): Promise<PVEAuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

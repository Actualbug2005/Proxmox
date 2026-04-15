/**
 * Double-submit CSRF protection.
 *
 * Token = HMAC-SHA256(JWT_SECRET, sessionId). Derived deterministically from
 * the sessionId, so we don't need a separate store. The client reads it from
 * a non-httpOnly companion cookie (nexus_csrf) and echoes it in the
 * X-Nexus-CSRF header on mutating requests. The server re-derives the
 * expected value and compares it in constant time.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getJwtSecret } from '@/lib/env';

export const CSRF_COOKIE = 'nexus_csrf';
export const CSRF_HEADER = 'x-nexus-csrf';

export function deriveCsrfToken(sessionId: string): string {
  const key = getJwtSecret();
  return createHmac('sha256', Buffer.from(key)).update(sessionId).digest('hex');
}

export function csrfMatches(expected: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validate the X-Nexus-CSRF header against the HMAC derived from the caller's
 * sessionId. Returns true on success. Use from every mutating route handler
 * after the session has been resolved.
 */
export function validateCsrf(req: NextRequest, sessionId: string): boolean {
  const provided = req.headers.get(CSRF_HEADER);
  return csrfMatches(deriveCsrfToken(sessionId), provided);
}

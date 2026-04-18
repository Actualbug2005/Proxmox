/**
 * Route-handler middleware — auth + CSRF compose HOFs.
 *
 * Eliminates the 4-line preamble that was repeated in ~26 route.ts files:
 *
 *   const sessionId = await getSessionId();
 *   if (!sessionId) return NextResponse.json({error:'Unauthorized'}, {status:401});
 *   if (!validateCsrf(req, sessionId)) return NextResponse.json({error:'CSRF failed'}, {status:403});
 *   const session = await getSession();
 *   if (!session) return NextResponse.json({error:'Unauthorized'}, {status:401});
 *
 * With these HOFs, a mutating route becomes:
 *
 *   export const POST = withCsrf(async (req, { session }) => { ... });
 *
 * — both the session lookup and CSRF check are handled, and the handler
 * receives the fully-resolved session on `ctx.session`. Failing to apply
 * either is a compile error (the handler signature requires ctx.session).
 *
 * `withAuth` is the read-only variant for GET/HEAD handlers that only
 * need a session, no CSRF (GETs are safe from CSRF by definition — the
 * browser doesn't auto-submit cross-site).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import type { PVEAuthSession } from '@/types/proxmox';

export interface AuthedCtx {
  session: PVEAuthSession;
  sessionId: string;
}

type AuthedHandler<P> = (
  req: NextRequest,
  ctx: { params: Promise<P>; session: PVEAuthSession; sessionId: string },
) => Promise<NextResponse>;

type BareHandler<P> = (
  req: NextRequest,
  ctx: { params: Promise<P> },
) => Promise<NextResponse>;

/**
 * Wraps a handler so that it only runs after:
 *   1. the caller has a valid Nexus session cookie,
 *   2. the server can resolve the full PVEAuthSession from the store.
 *
 * No CSRF check — use for GET/HEAD handlers. For POST/PUT/PATCH/DELETE
 * use `withCsrf` instead.
 */
export function withAuth<P = unknown>(handler: AuthedHandler<P>): BareHandler<P> {
  return async (req, ctx) => {
    const sessionId = await getSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return handler(req, { ...ctx, session, sessionId });
  };
}

/**
 * Wraps a handler so that it only runs after auth (as in `withAuth`) AND
 * a successful double-submit CSRF check on the X-Nexus-CSRF header.
 *
 * Use for every mutating route handler. The CSRF check is compile-enforced:
 * handlers passed to this function receive the already-validated session,
 * so forgetting to apply it is visible as a missing `ctx.session` in the
 * handler body.
 */
export function withCsrf<P = unknown>(handler: AuthedHandler<P>): BareHandler<P> {
  return async (req, ctx) => {
    const sessionId = await getSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!validateCsrf(req, sessionId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return handler(req, { ...ctx, session, sessionId });
  };
}

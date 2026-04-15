import { NextRequest, NextResponse } from 'next/server';
import { getJwtSecret } from '@/lib/env';

// Fail-closed at module init. If JWT_SECRET is unset we refuse to serve
// anything — the API routes also enforce this, but failing here means the
// whole app surface goes down instead of silently accepting forged sessions.
getJwtSecret();

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

// A valid nexus_session cookie is 32 bytes hex = 64 chars of [0-9a-f]. Any
// other format is malformed and gets treated as unauthenticated. The
// server-side API routes do the full store lookup; this check only decides
// whether to render the dashboard shell or redirect to /login.
const SESSION_ID_RE = /^[a-f0-9]{64}$/;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get('nexus_session')?.value;

  if (!token || !SESSION_ID_RE.test(token)) {
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete('nexus_session');
    res.cookies.delete('nexus_csrf');
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

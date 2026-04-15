import { NextRequest, NextResponse } from 'next/server';
import { clearSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (sessionId && !validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}

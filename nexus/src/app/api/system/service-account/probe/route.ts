/**
 * Re-probe the currently-loaded service-account singleton.
 *
 * Does NOT touch persisted credentials — this only exercises the
 * in-memory session against the Proxmox host and returns the outcome.
 * Useful for the settings UI's "Test connection" button after a save.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import { getServiceSession } from '@/lib/service-account/session';
import { probeServiceAccount } from '@/lib/service-account/probe';

export const POST = withCsrf(async () => {
  const session = getServiceSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'no service account configured' },
      { status: 400 },
    );
  }
  const result = await probeServiceAccount(session);
  return NextResponse.json(result);
});

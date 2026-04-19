/**
 * Service-account credentials — GET / PUT / DELETE.
 *
 * GET returns the current status (never the secret). PUT validates and
 * saves a new `{ tokenId, secret, proxmoxHost }` triple, reloads the
 * singleton (which re-probes), then returns the fresh status. DELETE
 * clears the stored credentials and resets the singleton.
 *
 * Mutating verbs use `withCsrf` (auth + CSRF in one HOF); GET uses
 * `withAuth`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { deleteConfig, saveConfig } from '@/lib/service-account/store';
import {
  getServiceAccountStatus,
  reloadServiceAccount,
} from '@/lib/service-account/session';

export const GET = withAuth(async () => {
  return NextResponse.json(getServiceAccountStatus(), {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});

export const PUT = withCsrf(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'missing body' }, { status: 400 });
  }
  const { tokenId, secret, proxmoxHost } = body as Record<string, unknown>;
  if (
    typeof tokenId !== 'string' ||
    typeof secret !== 'string' ||
    typeof proxmoxHost !== 'string'
  ) {
    return NextResponse.json(
      { error: 'tokenId, secret, proxmoxHost must all be strings' },
      { status: 400 },
    );
  }
  try {
    await saveConfig({ tokenId, secret, proxmoxHost, savedAt: Date.now() });
    await reloadServiceAccount();
    return NextResponse.json(getServiceAccountStatus());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
});

export const DELETE = withCsrf(async () => {
  await deleteConfig();
  await reloadServiceAccount();
  return NextResponse.json(getServiceAccountStatus());
});

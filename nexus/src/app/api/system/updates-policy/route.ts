/**
 * GET   /api/system/updates-policy — persisted auto-update policy
 * PATCH /api/system/updates-policy — strict-validated policy patch
 *
 * The existing `/api/system/update` route still drives manual installs
 * (argv-only call into `nexus-update`). This route only manages
 * operator preferences for the scheduled check/install loop.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { getPolicy, updatePolicy } from '@/lib/updates/store';
import { validateCron } from '@/lib/cron-match';
import type {
  AutoInstallScope,
  UpdateChannel,
  UpdatePolicyMode,
} from '@/lib/updates/types';

const MODES: readonly UpdatePolicyMode[] = ['off', 'notify', 'auto'];
const SCOPES: readonly AutoInstallScope[] = ['patch', 'minor', 'any'];
const CHANNELS: readonly UpdateChannel[] = ['stable', 'prerelease'];

export const GET = withAuth(async () => {
  const policy = await getPolicy();
  return NextResponse.json(policy, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});

export const PATCH = withCsrf(async (req) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode as UpdatePolicyMode)) {
      return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
    }
    patch.mode = body.mode;
  }
  if (body.channel !== undefined) {
    if (!CHANNELS.includes(body.channel as UpdateChannel)) {
      return NextResponse.json({ error: 'invalid channel' }, { status: 400 });
    }
    patch.channel = body.channel;
  }
  if (body.autoInstallScope !== undefined) {
    if (!SCOPES.includes(body.autoInstallScope as AutoInstallScope)) {
      return NextResponse.json(
        { error: 'invalid autoInstallScope' },
        { status: 400 },
      );
    }
    patch.autoInstallScope = body.autoInstallScope;
  }
  if (body.cron !== undefined) {
    if (typeof body.cron !== 'string' || body.cron.trim().length === 0) {
      return NextResponse.json({ error: 'cron must be a string' }, { status: 400 });
    }
    try {
      validateCron(body.cron);
    } catch (err) {
      return NextResponse.json(
        { error: `invalid cron: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 },
      );
    }
    patch.cron = body.cron;
  }

  // lastCheckedAt / lastSeenTag / lastAutoInstallAt are server-owned;
  // reject attempts to write them directly.
  for (const k of ['lastCheckedAt', 'lastSeenTag', 'lastAutoInstallAt']) {
    if (body[k] !== undefined) {
      return NextResponse.json(
        { error: `${k} is server-managed and cannot be patched` },
        { status: 400 },
      );
    }
  }

  const updated = await updatePolicy(patch);
  return NextResponse.json(updated, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});

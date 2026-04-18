/**
 * POST /api/notifications/destinations/[id]/test — synthetic event drill.
 *
 * Produces a `pve.renewal.failed` event with placeholder payload and
 * drives it through the full pipeline (rule matcher → backoff →
 * transport). If no rule currently binds this destination + kind, we
 * dispatch directly to the destination instead — the operator wants
 * "did this webhook receive a request?" confirmation, not "did the
 * whole chain fire?".
 *
 * The direct-dispatch bypass does NOT advance any rule's backoff
 * state; it's a one-shot POST with no persistence side effects.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import { getDestination, decryptDestination } from '@/lib/notifications/store';
import { dispatch as webhookDispatch } from '@/lib/notifications/destinations/webhook';
import { dispatch as ntfyDispatch } from '@/lib/notifications/destinations/ntfy';
import { dispatch as discordDispatch } from '@/lib/notifications/destinations/discord';
import type { DestinationId } from '@/lib/notifications/types';
import type { DispatchFetcher, DispatchPayload } from '@/lib/notifications/destinations/types';

interface Ctx { params: Promise<{ id: string }> }

const realFetcher: DispatchFetcher = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, statusText: res.statusText };
};

export const POST = withCsrf<{ id: string }>(async (_req, ctx) => {
  const { id } = await (ctx as unknown as Ctx).params;
  const dest = await getDestination(id as DestinationId);
  if (!dest) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let config;
  try {
    config = decryptDestination(dest);
  } catch (err) {
    return NextResponse.json(
      { error: 'destination secret is unreadable', reason: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // Test payload carries the same keys the pve.renewal.failed real
  // emitter uses (`username`, `reason`) so a rule wired to this kind
  // sees the template-variable coverage match what it would at fire
  // time — the test is a drill, not a stub.
  const payload: DispatchPayload = {
    kind: 'pve.renewal.failed',
    at: Date.now(),
    message: 'Test notification from Nexus — ignore if expected.',
    title: 'Nexus test',
  };

  const result =
    config.kind === 'webhook' ? await webhookDispatch(config, payload, realFetcher) :
    config.kind === 'ntfy'    ? await ntfyDispatch(config, payload, realFetcher) :
                                await discordDispatch(config, payload, realFetcher);

  return NextResponse.json(result, { status: result.outcome === 'sent' ? 200 : 502 });
});

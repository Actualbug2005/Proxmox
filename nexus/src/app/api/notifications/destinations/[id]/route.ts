/**
 * Destination update + delete.
 *
 * DELETE cascades — rules pointing at the destination are dropped by
 * the store. This is the operator-friendly behaviour; leaving an
 * orphaned rule would silently fail at fire time.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import {
  removeDestination,
  updateDestination,
} from '@/lib/notifications/store';
import type { DestinationId } from '@/lib/notifications/types';
import { parseDestinationPatch } from '../../validators';

interface Ctx { params: Promise<{ id: string }> }

export const PATCH = withCsrf<{ id: string }>(async (req, ctx) => {
  const { id } = await (ctx as unknown as Ctx).params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseDestinationPatch(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const updated = await updateDestination(id as DestinationId, parsed.value);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    destination: {
      id: updated.id, name: updated.name, kind: updated.kind,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
    },
  });
});

export const DELETE = withCsrf<{ id: string }>(async (_req, ctx) => {
  const { id } = await (ctx as unknown as Ctx).params;
  const ok = await removeDestination(id as DestinationId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});

/**
 * Rule update + delete.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import { removeRule, updateRule } from '@/lib/notifications/store';
import type { DestinationId, RuleId } from '@/lib/notifications/types';
import { parseRulePatch } from '../../validators';

interface Ctx { params: Promise<{ id: string }> }

export const PATCH = withCsrf<{ id: string }>(async (req, ctx) => {
  const { id } = await (ctx as unknown as Ctx).params;
  const raw = await req.json().catch(() => ({}));
  const parsed = parseRulePatch(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // The store's updateRule spreads the patch over the existing record;
  // casting destinationId here is the single place that crosses the
  // string → DestinationId boundary post-validation.
  const patch = {
    ...parsed.value,
    destinationId: parsed.value.destinationId as DestinationId | undefined,
  };
  const updated = await updateRule(id as RuleId, patch);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ rule: updated });
});

export const DELETE = withCsrf<{ id: string }>(async (_req, ctx) => {
  const { id } = await (ctx as unknown as Ctx).params;
  const ok = await removeRule(id as RuleId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});

/**
 * Rules CRUD — list + create.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { createRule, listRules } from '@/lib/notifications/store';
import type { DestinationId } from '@/lib/notifications/types';
import { parseRuleInput } from '../validators';

export const GET = withAuth(async () => {
  const rules = await listRules();
  return NextResponse.json({ rules }, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});

export const POST = withCsrf(async (req) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseRuleInput(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const created = await createRule({
      ...parsed.value,
      destinationId: parsed.value.destinationId as DestinationId,
    });
    return NextResponse.json({ rule: created }, { status: 201 });
  } catch (err) {
    // `createRule` throws "Destination X does not exist" when the id is
    // stale — surface that as a 400, not a 500.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
});

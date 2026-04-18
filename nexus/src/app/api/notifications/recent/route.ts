/**
 * GET /api/notifications/recent — last N dispatch records from the
 * in-process ring buffer. Non-persisted; the buffer resets on every
 * Nexus restart, which matches how the operator thinks about "recent"
 * (the last few hours of uptime, not history).
 *
 * Capped at 200 to match the ring size — asking for more just returns
 * everything the buffer has.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { recentDispatches } from '@/lib/notifications/dispatcher';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get('limit');
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
  return NextResponse.json(
    { dispatches: recentDispatches(limit) },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

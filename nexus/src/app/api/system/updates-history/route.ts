/**
 * GET /api/system/updates-history — recent entries from run-history.jsonl
 * filtered to `source=update`.
 *
 * Backs the "Recent checks" table on /dashboard/system/updates so the
 * operator can see what the auto-update loop has been doing across
 * restarts.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { listRuns } from '@/lib/run-history/store';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get('limit');
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  const limit =
    Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
  const runs = await listRuns('update', 'check', limit);
  return NextResponse.json(
    { runs },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

/**
 * GET /api/cluster/drs/log — recent DRS history entries for the UI.
 *
 * The history ring lives in `drs-policy.json`. This route is a thin
 * read-only wrapper so the UI can poll at the same cadence as the
 * notifications-recent panel (30 s) without parsing the full state.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { recentHistory } from '@/lib/drs/store';

const DEFAULT = 50;
const MAX = 200;

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get('limit');
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT;
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX) : DEFAULT;
  return NextResponse.json(
    { history: await recentHistory(limit) },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

/**
 * GET /api/scripts/schedules/[id]/runs — persistent per-schedule fire log.
 *
 * Reads the newest `limit` (default 20, capped 100) entries from
 * `run-history.jsonl` for `source=schedule, sourceId=id`. In-memory
 * script-job logs are GC'd after 24 h, so this endpoint is how the
 * UI renders a "last N fires" table long after the underlying job
 * log is gone.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { listRuns } from '@/lib/run-history/store';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface Params {
  id: string;
}

export const GET = withAuth<Params>(async (req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const raw = url.searchParams.get('limit');
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  const limit =
    Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
  const runs = await listRuns('schedule', id, limit);
  return NextResponse.json(
    { runs },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

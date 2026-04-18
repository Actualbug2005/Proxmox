/**
 * GET /api/scripts/jobs — recent jobs for the signed-in user.
 *
 * Returns a compact summary list suitable for the bottom-right status bar
 * and job-history drawer. Per-job output is NOT included here — callers
 * fetch the full log via /api/scripts/jobs/[jobId].
 *
 * Scope:
 *   - Filtered by session.username so one user can't see another's jobs.
 *   - Default limit 20, capped at 100 via ?limit=.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { listJobsForUser, type JobRecord } from '@/lib/script-jobs';

/**
 * Summary shape the UI consumes. Matches JobRecord minus the in-memory
 * tail (large) and user field (implied by the requester).
 */
export interface JobSummary {
  id: string;
  node: string;
  scriptName: string;
  slug?: string;
  method?: string;
  status: JobRecord['status'];
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
}

function toSummary(j: JobRecord): JobSummary {
  return {
    id: j.id,
    node: j.node,
    scriptName: j.scriptName,
    slug: j.slug,
    method: j.method,
    status: j.status,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    exitCode: j.exitCode,
  };
}

export const GET = withAuth(async (req, { session }) => {
  const rawLimit = req.nextUrl.searchParams.get('limit');
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20;

  const jobs = listJobsForUser(session.username, limit).map(toSummary);
  return NextResponse.json({ jobs });
});

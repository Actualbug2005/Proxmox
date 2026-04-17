/**
 * GET  /api/scripts/jobs/[jobId] — full detail + log for one job.
 * DELETE /api/scripts/jobs/[jobId] — abort a running job (SIGTERM).
 *
 * Ownership:
 *   Only the user who created a job can read or abort it. The registry
 *   stores session.username on each record; we compare that to the current
 *   session to decide 403 vs serve.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { abortJob, getJob, readJobLog } from '@/lib/script-jobs';

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { jobId } = await ctx.params;
  if (!JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (job.user !== session.username) {
    // Don't leak existence to other users.
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // ?tail=0 returns an empty log (used by the status-bar mini view which
  // only wants the summary). Default returns the full on-disk log capped
  // at 4 MB by readJobLog.
  const tailParam = req.nextUrl.searchParams.get('tail');
  const wantsTailOnly = tailParam === '0';
  const log = wantsTailOnly ? '' : await readJobLog(job.id);

  return NextResponse.json({
    id: job.id,
    node: job.node,
    scriptName: job.scriptName,
    slug: job.slug,
    method: job.method,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    scriptUrl: job.scriptUrl,
    env: job.env,
    // `tail` is the in-memory ring (always small, cheap to include), `log`
    // is the on-disk file — identical when the script hasn't produced more
    // than 64 KB of output, truncated-from-the-front thereafter.
    tail: job.tail,
    log,
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { jobId } = await ctx.params;
  if (!JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job || job.user !== session.username) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  if (job.status !== 'running') {
    return NextResponse.json({ error: 'Job is not running' }, { status: 409 });
  }

  const ok = abortJob(jobId);
  return NextResponse.json({ aborted: ok });
}

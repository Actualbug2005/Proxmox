/**
 * /api/scripts/schedules — CRUD for scheduled community-script jobs.
 *
 * GET  — list schedules owned by the current session user.
 * POST — create a new schedule.
 *
 * Validation parity with /api/scripts/run is intentional: the scheduler
 * re-validates at fire time as defense in depth, but we still enforce at
 * create time so a malformed or untrusted request never becomes a stored
 * record in the first place.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { requireNodeSysModify } from '@/lib/permissions';
import { EXEC_LIMITS } from '@/lib/exec-policy';
import { RATE_LIMITS, takeToken } from '@/lib/rate-limit';
import { validateCron } from '@/lib/cron-match';
import {
  RunScriptJobError,
  validateNodeName,
  validateScriptUrl,
} from '@/lib/run-script-job';
import { sanitiseEnv } from '@/lib/script-jobs';
import * as store from '@/lib/scheduled-jobs-store';
import { toDto } from '@/lib/scheduled-jobs-dto';

// ─── GET ─────────────────────────────────────────────────────────────────────

export const GET = withAuth(async (_req, { session }) => {
  const jobs = await store.listForUser(session.username);
  return NextResponse.json({
    jobs: jobs
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toDto),
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

interface CreateBody {
  slug?: string;
  scriptUrl?: string;
  scriptName?: string;
  node?: string;
  method?: string;
  env?: Record<string, unknown>;
  timeoutMs?: number;
  schedule?: string;
  enabled?: boolean;
}

export const POST = withCsrf(async (req, { session, sessionId }) => {
  const body = (await req.json()) as CreateBody;

  if (!body.node || !body.scriptUrl || !body.scriptName || !body.schedule) {
    return NextResponse.json(
      { error: 'node, scriptUrl, scriptName, and schedule are required' },
      { status: 400 },
    );
  }

  // Node + scriptUrl re-validation — throws RunScriptJobError(400) we turn
  // into a 400 response. Defensive copy of the messages keeps parity with
  // /api/scripts/run error text.
  let node: string;
  let parsedUrl: URL;
  try {
    node = validateNodeName(body.node);
    parsedUrl = validateScriptUrl(body.scriptUrl);
  } catch (err) {
    if (err instanceof RunScriptJobError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    validateCron(body.schedule);
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  if (!(await requireNodeSysModify(session, node))) {
    return NextResponse.json(
      { error: 'Forbidden: Sys.Modify required on /nodes/' + node },
      { status: 403 },
    );
  }

  // Mildly rate-limited — scheduling should be rare; protects against a
  // script-spam client. Same token bucket key space as manual runs, but a
  // lower bucket would stack; instead we use a dedicated name.
  const token = await takeToken(
    sessionId,
    'scripts.schedules',
    RATE_LIMITS.scriptsRun.limit,
    RATE_LIMITS.scriptsRun.windowMs,
  );
  if (!token.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterMs: token.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((token.retryAfterMs ?? 0) / 1000)) } },
    );
  }

  // Pre-sanitise env so the stored record matches what the scheduler will
  // actually run. Rejected keys are silently dropped — same semantics as
  // /api/scripts/run.
  const { env: safeEnv } = sanitiseEnv(body.env ?? {});

  const timeoutMs =
    typeof body.timeoutMs === 'number' &&
    Number.isFinite(body.timeoutMs) &&
    body.timeoutMs > 0
      ? Math.min(body.timeoutMs, EXEC_LIMITS.maxTimeoutMs)
      : undefined;

  const created = await store.create({
    owner: session.username,
    slug: typeof body.slug === 'string' && body.slug.length <= 63 ? body.slug : undefined,
    scriptUrl: parsedUrl.toString(),
    scriptName: body.scriptName,
    node,
    method: typeof body.method === 'string' && body.method.length <= 32 ? body.method : undefined,
    env: safeEnv,
    timeoutMs,
    schedule: body.schedule,
    enabled: body.enabled !== false,
  });

  return NextResponse.json({ job: toDto(created) }, { status: 201 });
});

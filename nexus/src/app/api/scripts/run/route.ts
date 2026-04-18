/**
 * POST /api/scripts/run — fire-and-forget community-script executor.
 *
 * Thin route handler around runScriptJob() from @/lib/run-script-job.
 * Responsibilities kept here (not in the shared runner):
 *   1. Authn: session cookie + CSRF double-submit header.
 *   2. Authz: PVE ACL Sys.Modify on /nodes/<node>.
 *   3. Rate limiting: token bucket + concurrency slot per session.
 *   4. Input parsing.
 *
 * Everything past that — URL/origin revalidation, spawn, audit — is the
 * shared runner's job so the scheduler tick has identical semantics.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import { requireNodeSysModify } from '@/lib/permissions';
import { EXEC_LIMITS } from '@/lib/exec-policy';
import { RATE_LIMITS, acquireSlot, takeToken } from '@/lib/rate-limit';
import { RunScriptJobError, runScriptJob } from '@/lib/run-script-job';

export const POST = withCsrf(async (req, { session, sessionId }) => {
  const body = (await req.json()) as {
    node?: string;
    scriptUrl?: string;
    scriptName?: string;
    slug?: string;
    method?: string;
    env?: Record<string, unknown>;
    timeoutMs?: number;
  };
  const { node, scriptUrl, scriptName, slug, method, env, timeoutMs: rawTimeoutMs } = body;

  if (!node || !scriptUrl) {
    return NextResponse.json({ error: 'node and scriptUrl are required' }, { status: 400 });
  }

  const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
  const timeoutMs =
    typeof rawTimeoutMs === 'number' && Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
      ? Math.min(rawTimeoutMs, EXEC_LIMITS.maxTimeoutMs)
      : DEFAULT_TIMEOUT_MS;

  // ACL is on the PVE side, so it stays here — the scheduler enforced it at
  // schedule-create time on behalf of the owner.
  if (!(await requireNodeSysModify(session, node))) {
    return NextResponse.json(
      { error: 'Forbidden: Sys.Modify required on /nodes/' + node },
      { status: 403 },
    );
  }

  const token = await takeToken(
    sessionId,
    'scripts.run',
    RATE_LIMITS.scriptsRun.limit,
    RATE_LIMITS.scriptsRun.windowMs,
  );
  if (!token.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterMs: token.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((token.retryAfterMs ?? 0) / 1000)) } },
    );
  }

  const slot = await acquireSlot(
    sessionId,
    'scripts.run',
    RATE_LIMITS.scriptsRun.maxConcurrent,
    EXEC_LIMITS.maxTimeoutMs + 60_000,
  );
  if (!slot) {
    return NextResponse.json(
      { error: `Concurrency limit reached (max ${RATE_LIMITS.scriptsRun.maxConcurrent} in flight per session)` },
      { status: 429 },
    );
  }

  try {
    const result = await runScriptJob({
      user: session.username,
      node,
      scriptUrl,
      scriptName: typeof scriptName === 'string' ? scriptName : '',
      slug: typeof slug === 'string' ? slug : undefined,
      method: typeof method === 'string' ? method : undefined,
      env,
      timeoutMs,
      onClose: async () => {
        await slot.release();
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    // If runScriptJob never spawned (validation failure), release the slot
    // immediately — otherwise we'd leak a slot until the acquire-TTL.
    await slot.release();
    if (err instanceof RunScriptJobError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
});

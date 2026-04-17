/**
 * POST /api/scripts/chains/[id]/run — ad-hoc chain execution.
 *
 * Returns immediately; the actual step fires happen inside runChain().
 * The UI polls /api/scripts/chains/[id] to observe lastRun progress.
 *
 * Each step is re-validated by run-chain.ts at fire time, but we also
 * ACL-check here so a non-owner or a user who lost Sys.Modify since
 * chain creation can't trigger a run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { requireNodeSysModify } from '@/lib/permissions';
import { RATE_LIMITS, takeToken } from '@/lib/rate-limit';
import * as store from '@/lib/chains-store';
import { runChain } from '@/lib/run-chain';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const chain = await store.get(id);
  if (!chain || chain.owner !== session.username) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const uniqueNodes = [...new Set(chain.steps.map((s) => s.node))];
  for (const node of uniqueNodes) {
    if (!(await requireNodeSysModify(session, node))) {
      return NextResponse.json(
        { error: `Forbidden: Sys.Modify required on /nodes/${node}` },
        { status: 403 },
      );
    }
  }

  const token = await takeToken(
    sessionId,
    'scripts.chains.run',
    RATE_LIMITS.scriptsChains.limit,
    RATE_LIMITS.scriptsChains.windowMs,
  );
  if (!token.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterMs: token.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((token.retryAfterMs ?? 0) / 1000)) },
      },
    );
  }

  await store.markFired(id, Date.now());
  runChain(chain);

  return NextResponse.json({ started: true, chainId: id }, { status: 202 });
}

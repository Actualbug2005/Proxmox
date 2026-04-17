/**
 * /api/scripts/chains — CRUD for ordered script chains.
 *
 * GET  — list chains owned by the current session user.
 * POST — create a new chain.
 *
 * Validation mirrors /api/scripts/run + /api/scripts/schedules: each step
 * is re-checked at fire time by run-chain.ts as defense in depth, but we
 * reject malformed steps up-front so bad data never lands in the JSON
 * store.
 *
 * ACL: every step's target node must pass requireNodeSysModify for the
 * owning session. A chain that touches 3 nodes requires Sys.Modify on all
 * 3, checked at create + PATCH time. Re-checks at fire time are the
 * runner's job.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
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
import * as store from '@/lib/chains-store';
import type { ChainStep, ChainStepPolicy } from '@/lib/chains-store';
import { toDto } from '@/lib/chains-dto';

// ─── Step validation helper ─────────────────────────────────────────────────

interface StepInput {
  slug?: unknown;
  scriptUrl?: unknown;
  scriptName?: unknown;
  node?: unknown;
  method?: unknown;
  env?: Record<string, unknown>;
  timeoutMs?: unknown;
}

type ValidationResult =
  | { kind: 'ok'; step: ChainStep }
  | { kind: 'err'; status: number; message: string };

function validateStep(raw: unknown, index: number): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { kind: 'err', status: 400, message: `step[${index}]: expected object` };
  }
  const s = raw as StepInput;
  if (typeof s.scriptUrl !== 'string' || typeof s.scriptName !== 'string' || typeof s.node !== 'string') {
    return {
      kind: 'err',
      status: 400,
      message: `step[${index}]: scriptUrl, scriptName, and node are required strings`,
    };
  }

  let node: string;
  let parsedUrl: URL;
  try {
    node = validateNodeName(s.node);
    parsedUrl = validateScriptUrl(s.scriptUrl);
  } catch (err) {
    if (err instanceof RunScriptJobError) {
      return { kind: 'err', status: err.status, message: `step[${index}]: ${err.message}` };
    }
    throw err;
  }

  const safeEnv = s.env ? sanitiseEnv(s.env).env : undefined;

  const timeoutMs =
    typeof s.timeoutMs === 'number' && Number.isFinite(s.timeoutMs) && s.timeoutMs > 0
      ? Math.min(s.timeoutMs, EXEC_LIMITS.maxTimeoutMs)
      : undefined;

  return {
    kind: 'ok',
    step: {
      slug: typeof s.slug === 'string' && s.slug.length <= 63 ? s.slug : undefined,
      scriptUrl: parsedUrl.toString(),
      scriptName: s.scriptName,
      node,
      method: typeof s.method === 'string' && s.method.length <= 32 ? s.method : undefined,
      env: safeEnv,
      timeoutMs,
    },
  };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const chains = await store.listForUser(session.username);
  return NextResponse.json({
    chains: chains
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toDto),
  });
}

// ─── POST ────────────────────────────────────────────────────────────────────

interface CreateBody {
  name?: string;
  description?: string;
  steps?: unknown[];
  policy?: ChainStepPolicy;
  schedule?: string;
  enabled?: boolean;
}

const MAX_STEPS = 32;

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as CreateBody;

  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return NextResponse.json({ error: 'steps must be a non-empty array' }, { status: 400 });
  }
  if (body.steps.length > MAX_STEPS) {
    return NextResponse.json(
      { error: `steps exceeds maximum of ${MAX_STEPS}` },
      { status: 400 },
    );
  }

  const validatedSteps: ChainStep[] = [];
  for (let i = 0; i < body.steps.length; i++) {
    const result = validateStep(body.steps[i], i);
    if (result.kind === 'err') {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
    validatedSteps.push(result.step);
  }

  if (body.schedule !== undefined && body.schedule !== '') {
    try {
      validateCron(body.schedule);
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 },
      );
    }
  }

  // ACL on every distinct target node — a chain that touches 3 nodes
  // requires Sys.Modify on all 3.
  const uniqueNodes = [...new Set(validatedSteps.map((s) => s.node))];
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
    'scripts.chains',
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

  const policy: ChainStepPolicy = body.policy === 'continue' ? 'continue' : 'halt-on-failure';

  const created = await store.create({
    owner: session.username,
    name: body.name,
    description: typeof body.description === 'string' ? body.description : undefined,
    steps: validatedSteps,
    policy,
    schedule: body.schedule && body.schedule.length > 0 ? body.schedule : undefined,
    enabled: body.enabled !== false,
  });

  return NextResponse.json({ chain: toDto(created) }, { status: 201 });
}

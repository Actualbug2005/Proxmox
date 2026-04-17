/**
 * /api/scripts/chains/[id] — per-chain read / update / delete.
 *
 * Access model: only the chain's owner may read, update, or delete it.
 * Non-owners get 404 to prevent id-probing — same pattern as schedules.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { requireNodeSysModify } from '@/lib/permissions';
import { EXEC_LIMITS } from '@/lib/exec-policy';
import { validateCron } from '@/lib/cron-match';
import {
  RunScriptJobError,
  validateNodeName,
  validateScriptUrl,
} from '@/lib/run-script-job';
import { sanitiseEnv } from '@/lib/script-jobs';
import * as store from '@/lib/chains-store';
import type { Chain, ChainStep, ChainStepPolicy } from '@/lib/chains-store';
import { toDto } from '@/lib/chains-dto';

const MAX_STEPS = 32;

interface PatchBody {
  name?: string;
  description?: string;
  steps?: unknown[];
  policy?: ChainStepPolicy;
  schedule?: string | null;
  enabled?: boolean;
}

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

async function loadOwned(
  id: string,
): Promise<
  | { kind: 'ok'; chain: Chain; user: string }
  | { kind: 'err'; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { kind: 'err', response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const chain = await store.get(id);
  if (!chain || chain.owner !== session.username) {
    return { kind: 'err', response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { kind: 'ok', chain, user: session.username };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await loadOwned(id);
  if (res.kind === 'err') return res.response;
  return NextResponse.json({ chain: toDto(res.chain) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const res = await loadOwned(id);
  if (res.kind === 'err') return res.response;
  const existing = res.chain;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as PatchBody;
  const patch: Partial<Omit<Chain, 'id' | 'owner' | 'createdAt'>> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.length === 0) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    patch.name = body.name;
  }
  if (body.description !== undefined) {
    patch.description = typeof body.description === 'string' ? body.description : undefined;
  }
  if (body.policy !== undefined) {
    patch.policy = body.policy === 'continue' ? 'continue' : 'halt-on-failure';
  }
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  if (body.schedule !== undefined) {
    if (body.schedule === null || body.schedule === '') {
      patch.schedule = undefined;
    } else {
      try {
        validateCron(body.schedule);
      } catch (err) {
        return NextResponse.json(
          { error: `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 },
        );
      }
      patch.schedule = body.schedule;
    }
  }

  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
      return NextResponse.json({ error: 'steps must be a non-empty array' }, { status: 400 });
    }
    if (body.steps.length > MAX_STEPS) {
      return NextResponse.json(
        { error: `steps exceeds maximum of ${MAX_STEPS}` },
        { status: 400 },
      );
    }
    const validated: ChainStep[] = [];
    for (let i = 0; i < body.steps.length; i++) {
      const result = validateStep(body.steps[i], i);
      if (result.kind === 'err') {
        return NextResponse.json({ error: result.message }, { status: result.status });
      }
      validated.push(result.step);
    }
    patch.steps = validated;

    // Any newly-introduced node must pass ACL. Nodes already in the
    // existing chain are assumed to still be authorized (a step PATCH
    // that only reorders nodes doesn't need a re-check every time).
    const existingNodes = new Set(existing.steps.map((s) => s.node));
    const newNodes = [...new Set(validated.map((s) => s.node))].filter(
      (n) => !existingNodes.has(n),
    );
    for (const node of newNodes) {
      if (!(await requireNodeSysModify(session, node))) {
        return NextResponse.json(
          { error: `Forbidden: Sys.Modify required on /nodes/${node}` },
          { status: 403 },
        );
      }
    }
  }

  const updated = await store.update(id, patch);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ chain: toDto(updated) });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const res = await loadOwned(id);
  if (res.kind === 'err') return res.response;

  const removed = await store.remove(id);
  if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ removed: true });
}

/**
 * /api/scripts/schedules/[id] — per-schedule read/update/delete.
 *
 * Access model: only the schedule's owner may read, update, or delete it.
 * There is no "admin override" today; that lands when the UI grows a
 * team/organisation concept.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { requireNodeSysModify } from '@/lib/permissions';
import type { PVEAuthSession } from '@/types/proxmox';
import { EXEC_LIMITS } from '@/lib/exec-policy';
import { validateCron } from '@/lib/cron-match';
import {
  RunScriptJobError,
  validateNodeName,
  validateScriptUrl,
} from '@/lib/run-script-job';
import { sanitiseEnv } from '@/lib/script-jobs';
import * as store from '@/lib/scheduled-jobs-store';
import { toDto } from '@/lib/scheduled-jobs-dto';

interface PatchBody {
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

/**
 * Look up a schedule by id and ensure the caller owns it. Returns 404 for
 * both "not found" and "not yours" so a non-owner can't probe for schedule
 * ids by status code. Now takes the resolved session so callers don't pay
 * a second `getSession` round-trip.
 */
async function loadOwned(
  id: string,
  session: PVEAuthSession,
): Promise<
  | { kind: 'ok'; job: store.ScheduledJob }
  | { kind: 'err'; response: NextResponse }
> {
  const job = await store.get(id);
  if (!job || job.owner !== session.username) {
    return { kind: 'err', response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { kind: 'ok', job };
}

export const GET = withAuth<{ id: string }>(async (_req, { params, session }) => {
  const { id } = await params;
  const res = await loadOwned(id, session);
  if (res.kind === 'err') return res.response;
  return NextResponse.json({ job: toDto(res.job) });
});

export const PATCH = withCsrf<{ id: string }>(async (req, { params, session }) => {
  const { id } = await params;
  const res = await loadOwned(id, session);
  if (res.kind === 'err') return res.response;
  const existing = res.job;

  const body = (await req.json()) as PatchBody;
  const patch: Partial<Omit<store.ScheduledJob, 'id' | 'owner' | 'createdAt'>> = {};

  if (body.scriptUrl !== undefined) {
    try {
      patch.scriptUrl = validateScriptUrl(body.scriptUrl).toString();
    } catch (err) {
      if (err instanceof RunScriptJobError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  }
  if (body.scriptName !== undefined) patch.scriptName = String(body.scriptName);
  if (body.slug !== undefined) {
    patch.slug = typeof body.slug === 'string' && body.slug.length <= 63 ? body.slug : undefined;
  }
  if (body.method !== undefined) {
    patch.method =
      typeof body.method === 'string' && body.method.length <= 32 ? body.method : undefined;
  }
  if (body.env !== undefined) {
    patch.env = sanitiseEnv(body.env).env;
  }
  if (body.timeoutMs !== undefined) {
    if (
      typeof body.timeoutMs === 'number' &&
      Number.isFinite(body.timeoutMs) &&
      body.timeoutMs > 0
    ) {
      patch.timeoutMs = Math.min(body.timeoutMs, EXEC_LIMITS.maxTimeoutMs);
    } else {
      patch.timeoutMs = undefined;
    }
  }
  if (body.schedule !== undefined) {
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
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

  // Node change re-checks ACL. No change → reuse the existing record's node.
  let targetNode = existing.node;
  if (body.node !== undefined) {
    try {
      targetNode = validateNodeName(body.node);
    } catch (err) {
      if (err instanceof RunScriptJobError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
    patch.node = targetNode;
  }
  if (patch.node && patch.node !== existing.node) {
    if (!(await requireNodeSysModify(session, targetNode))) {
      return NextResponse.json(
        { error: 'Forbidden: Sys.Modify required on /nodes/' + targetNode },
        { status: 403 },
      );
    }
  }

  const updated = await store.update(id, patch);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ job: toDto(updated) });
});

export const DELETE = withCsrf<{ id: string }>(async (_req, { params, session }) => {
  const { id } = await params;
  const res = await loadOwned(id, session);
  if (res.kind === 'err') return res.response;

  const removed = await store.remove(id);
  if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ removed: true });
});

/**
 * GET  /api/cluster/drs — full DRS state (policy + cooldown + history)
 * PATCH /api/cluster/drs — partial policy update
 *
 * No DELETE: DRS is singleton-per-cluster. Operators disable it by
 * setting `mode: 'off'` rather than removing the record.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { getState, updatePolicy } from '@/lib/drs/store';
import type { DrsPolicy, DrsMode } from '@/lib/drs/types';
import { unsafeCronExpr } from '@/types/brands';
import { validateCron } from '@/lib/cron-match';

export const GET = withAuth(async () => {
  const state = await getState();
  // Cooldowns stay server-side — UI only needs policy + history.
  return NextResponse.json(
    { policy: state.policy, history: state.history.slice(-50).reverse() },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

function str(v: unknown, field: string, max = 256): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    return { ok: false, error: `${field} must be a non-empty string ≤ ${max} chars` };
  }
  return { ok: true, value: v };
}

function num(v: unknown, field: string, min: number, max: number): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    return { ok: false, error: `${field} must be a finite number in [${min}, ${max}]` };
  }
  return { ok: true, value: v };
}

function parsePatch(raw: unknown): { ok: true; value: Partial<DrsPolicy> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  const out: Partial<DrsPolicy> = {};

  if (obj.mode !== undefined) {
    const modes = ['off', 'dry-run', 'enabled'] as const;
    if (!modes.includes(obj.mode as DrsMode)) {
      return { ok: false, error: `mode must be one of: ${modes.join(', ')}` };
    }
    out.mode = obj.mode as DrsMode;
  }
  if (obj.hotCpuAbs !== undefined) {
    const r = num(obj.hotCpuAbs, 'hotCpuAbs', 0, 1); if (!r.ok) return r; out.hotCpuAbs = r.value;
  }
  if (obj.hotMemAbs !== undefined) {
    const r = num(obj.hotMemAbs, 'hotMemAbs', 0, 1); if (!r.ok) return r; out.hotMemAbs = r.value;
  }
  if (obj.relativeDelta !== undefined) {
    const r = num(obj.relativeDelta, 'relativeDelta', 0, 1); if (!r.ok) return r; out.relativeDelta = r.value;
  }
  if (obj.scoreDelta !== undefined) {
    const r = num(obj.scoreDelta, 'scoreDelta', 0, 100); if (!r.ok) return r; out.scoreDelta = r.value;
  }
  if (obj.cooldownMin !== undefined) {
    const r = num(obj.cooldownMin, 'cooldownMin', 0, 24 * 60); if (!r.ok) return r; out.cooldownMin = r.value;
  }
  if (obj.maxPerTick !== undefined) {
    // Enforce 1 for now — the spec's safety rail. Widening this needs
    // a design pass (plan-in-batches, cascading safety, etc.).
    const r = num(obj.maxPerTick, 'maxPerTick', 1, 1); if (!r.ok) return r; out.maxPerTick = r.value;
  }
  if (obj.pinnedTag !== undefined) {
    const r = str(obj.pinnedTag, 'pinnedTag', 64); if (!r.ok) return r;
    // Tags on PVE are case-insensitive `[a-zA-Z0-9_:-]+`; mirror that
    // shape so a typo doesn't produce a ghost tag no one can apply.
    if (!/^[a-zA-Z0-9_:-]+$/.test(r.value)) {
      return { ok: false, error: 'pinnedTag must match [a-zA-Z0-9_:-]+' };
    }
    out.pinnedTag = r.value;
  }
  if (obj.blackoutCron !== undefined) {
    if (obj.blackoutCron === null || obj.blackoutCron === '') {
      out.blackoutCron = undefined;
    } else {
      const r = str(obj.blackoutCron, 'blackoutCron', 128);
      if (!r.ok) return r;
      try {
        validateCron(r.value);
      } catch (err) {
        return { ok: false, error: `blackoutCron invalid: ${err instanceof Error ? err.message : String(err)}` };
      }
      out.blackoutCron = unsafeCronExpr(r.value);
    }
  }
  return { ok: true, value: out };
}

export const PATCH = withCsrf(async (req) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parsePatch(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const next = await updatePolicy(parsed.value);
  return NextResponse.json({ policy: next });
});


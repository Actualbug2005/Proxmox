/**
 * Backoff is the state machine that shapes pager noise. A bug here
 * means either over-paging (miss the cooldown) or silent dropping
 * (misplan `nextEligibleAt`). Tests pin every path.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  intervalsForRule,
  planFire,
  previewIntervals,
  shouldFireResolve,
  curveNames,
} from './backoff.ts';
import { BACKOFF_CURVES } from './types.ts';
import type { BackoffConfig, Rule, DestinationId, RuleId } from './types.ts';

function rule(partial: Partial<Rule> = {}): Rule {
  return {
    id: 'rule_test' as RuleId,
    name: 'test',
    enabled: true,
    match: { eventKind: 'pve.renewal.failed' },
    destinationId: 'dest_test' as DestinationId,
    messageTemplate: '',
    consecutiveFires: 0,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('intervalsForRule', () => {
  it('defaults to the gentle preset when no backoff is set', () => {
    assert.deepEqual(intervalsForRule(rule()), BACKOFF_CURVES.gentle);
  });
  it('looks up built-in presets by name', () => {
    for (const name of curveNames()) {
      const r = rule({ backoff: { curve: name } });
      assert.deepEqual(intervalsForRule(r), BACKOFF_CURVES[name]);
    }
  });
  it('uses a custom array when curve=custom and input is valid', () => {
    const cfg: BackoffConfig = { curve: 'custom', customIntervalsMin: [0, 3, 10, 30] };
    assert.deepEqual(intervalsForRule(rule({ backoff: cfg })), cfg.customIntervalsMin);
  });
  it('falls back to gentle on malformed custom arrays', () => {
    const bad: BackoffConfig[] = [
      { curve: 'custom' },                                    // missing
      { curve: 'custom', customIntervalsMin: [] },            // empty
      { curve: 'custom', customIntervalsMin: [0, -1, 5] },    // negative entry
    ];
    for (const cfg of bad) {
      assert.deepEqual(intervalsForRule(rule({ backoff: cfg })), BACKOFF_CURVES.gentle);
    }
  });
});

describe('planFire', () => {
  it('fires immediately on first match (interval 0)', () => {
    const plan = planFire(rule(), 1_000_000);
    assert.equal(plan.action, 'fire');
    if (plan.action === 'fire') {
      assert.equal(plan.patch.consecutiveFires, 1);
      assert.equal(plan.patch.firstMatchAt, 1_000_000);
      // After fire #1, the wait to fire #2 on the gentle curve is
      // `curve[1]` = 5 min.
      assert.equal(plan.patch.nextEligibleAt, 1_000_000 + 5 * 60_000);
    }
  });

  it('skips when still inside the cooldown window', () => {
    const now = 1_000_000;
    const r = rule({
      consecutiveFires: 1,
      lastFireAt: now - 1_000,
      nextEligibleAt: now + 60_000,
    });
    const plan = planFire(r, now);
    assert.equal(plan.action, 'skip');
    if (plan.action === 'skip') assert.equal(plan.nextEligibleAt, now + 60_000);
  });

  it('fires again once past the cooldown and advances the curve slot', () => {
    const now = 1_000_000;
    const r = rule({
      consecutiveFires: 1,
      lastFireAt: now - 10 * 60_000,
      nextEligibleAt: now - 1_000,
    });
    const plan = planFire(r, now);
    assert.equal(plan.action, 'fire');
    if (plan.action === 'fire') {
      assert.equal(plan.patch.consecutiveFires, 2);
      // Gentle curve[2] = 15 minutes until the next eligible fire.
      assert.equal(plan.patch.nextEligibleAt, now + 15 * 60_000);
    }
  });

  it('clamps to the curve cap once consecutiveFires exceeds the curve length', () => {
    // Gentle has 4 slots (0, 5, 15, 60). After the 4th fire the wait
    // should stay at the cap (60 min) forever.
    const now = 1_000_000;
    const r = rule({ consecutiveFires: 10, nextEligibleAt: 0 });
    const plan = planFire(r, now);
    assert.equal(plan.action, 'fire');
    if (plan.action === 'fire') {
      assert.equal(plan.patch.nextEligibleAt, now + 60 * 60_000);
    }
  });
});

describe('shouldFireResolve', () => {
  it('fires resolve for multi-fire runs by default (policy=undefined → multi-fire)', () => {
    assert.equal(shouldFireResolve(rule({ consecutiveFires: 1 })), false);
    assert.equal(shouldFireResolve(rule({ consecutiveFires: 2 })), true);
  });
  it('honours explicit policies', () => {
    const single = rule({ consecutiveFires: 1 });
    assert.equal(shouldFireResolve({ ...single, resolvePolicy: 'always' }), true);
    assert.equal(shouldFireResolve({ ...single, resolvePolicy: 'never' }), false);
    assert.equal(shouldFireResolve({ ...single, resolvePolicy: 'multi-fire' }), false);
  });
  it('never resolves when there were zero fires — nothing to resolve from', () => {
    assert.equal(shouldFireResolve(rule({ consecutiveFires: 0, resolvePolicy: 'always' })), false);
  });
});

describe('previewIntervals (UI helper)', () => {
  it('returns the gentle curve for an undefined config (system default)', () => {
    assert.deepEqual(previewIntervals(undefined), BACKOFF_CURVES.gentle);
  });
});

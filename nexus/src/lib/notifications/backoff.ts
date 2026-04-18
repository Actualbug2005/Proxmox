/**
 * Fire-with-backoff state machine — pure functions over (rule, now).
 *
 * The dispatcher calls `planFire` for every matching event; the return
 * tells it whether to dispatch, how long to wait before the next fire,
 * and what the new rule-state fields are. The dispatcher then decides
 * whether to persist via `markRuleFired` (for 'fire') or
 * `markRuleCleared` (for a later sweep).
 *
 * The state-machine is deliberately stateless — all state lives on the
 * Rule record, which is the on-disk source of truth. That means a
 * process restart resumes the backoff mid-curve correctly.
 */

import {
  BACKOFF_CURVES,
  type BackoffConfig,
  type BuiltInCurveName,
  type Rule,
} from './types.ts';

const SYSTEM_DEFAULT_CURVE: BuiltInCurveName = 'gentle';

/**
 * Resolve a rule's intended interval schedule — preset lookup by name
 * when the rule references a built-in, or the `customIntervalsMin`
 * array when curve='custom'. Falls back to gentle on any malformed
 * input so a corrupted rule can't freeze the dispatcher.
 */
export function intervalsForRule(rule: Rule): readonly number[] {
  const cfg = rule.backoff;
  if (!cfg) return BACKOFF_CURVES[SYSTEM_DEFAULT_CURVE];
  if (cfg.curve === 'custom') {
    const arr = cfg.customIntervalsMin;
    if (Array.isArray(arr) && arr.length > 0 && arr.every((n) => n >= 0)) {
      return arr;
    }
    return BACKOFF_CURVES[SYSTEM_DEFAULT_CURVE];
  }
  return BACKOFF_CURVES[cfg.curve] ?? BACKOFF_CURVES[SYSTEM_DEFAULT_CURVE];
}

/**
 * Index into the curve for a given fire count. Clamps to the last
 * entry so `consecutiveFires > curve.length` keeps using the cap.
 */
function intervalForFireCount(
  rule: Rule,
  consecutiveFires: number,
): number {
  const curve = intervalsForRule(rule);
  const idx = Math.min(Math.max(0, consecutiveFires), curve.length - 1);
  return curve[idx];
}

/** Result shape for `planFire` — discriminated on action. */
export type FirePlan =
  | {
      action: 'fire';
      /** Mutations the dispatcher should persist via `markRuleFired`. */
      patch: {
        lastFireAt: number;
        nextEligibleAt: number;
        consecutiveFires: number;
        firstMatchAt: number;
      };
    }
  | {
      /** Still within the backoff window; skip this event. */
      action: 'skip';
      /** When the next fire becomes eligible, for ops visibility. */
      nextEligibleAt: number;
    };

/**
 * Decide whether a matching event should fire or be suppressed. Called
 * by the dispatcher for every event that satisfies a rule's predicate.
 *
 * Rules:
 *   - Never-fired-before → fire immediately at index 0 (interval 0).
 *   - `nextEligibleAt` in the future → skip; wait for the cooldown.
 *   - Otherwise → fire; bump consecutiveFires; schedule the next
 *     eligibility using the curve.
 */
export function planFire(rule: Rule, now: number): FirePlan {
  // Within backoff window — refuse.
  if (rule.nextEligibleAt !== undefined && now < rule.nextEligibleAt) {
    return { action: 'skip', nextEligibleAt: rule.nextEligibleAt };
  }

  const nextFires = rule.consecutiveFires + 1;
  // After firing, the NEXT fire should use the curve slot for that
  // count; i.e. if we're about to do fire #1, the cooldown is
  // `curve[1]` (the wait to fire #2). Clamp to the last entry.
  const cooldownMin = intervalForFireCount(rule, nextFires);

  return {
    action: 'fire',
    patch: {
      lastFireAt: now,
      nextEligibleAt: now + cooldownMin * 60_000,
      consecutiveFires: nextFires,
      firstMatchAt: rule.firstMatchAt ?? now,
    },
  };
}

/**
 * Decide whether a resolve-notification should fire when a rule's
 * predicate clears. Returns true when the rule's `resolvePolicy`
 * permits it and the accumulated fires meet the threshold.
 *
 *  - 'always'     → always, whenever there was at least one fire
 *  - 'multi-fire' → only when consecutiveFires >= 2 (your option c)
 *  - 'never'      → never
 */
export function shouldFireResolve(rule: Rule): boolean {
  if (rule.consecutiveFires === 0) return false;
  const policy = rule.resolvePolicy ?? 'multi-fire';
  if (policy === 'never') return false;
  if (policy === 'always') return true;
  return rule.consecutiveFires >= 2;
}

/** Exported so tests + UI can display the curve without importing types. */
export function curveNames(): readonly BuiltInCurveName[] {
  return Object.keys(BACKOFF_CURVES) as BuiltInCurveName[];
}

/** Exported so the UI can preview the sequence for a chosen config. */
export function previewIntervals(cfg: BackoffConfig | undefined): readonly number[] {
  return intervalsForRule({ backoff: cfg } as Rule);
}

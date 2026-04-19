'use client';

/**
 * Hook + pure predicate for the bell-icon pattern. Widgets embed an
 * <AlertBell> that shows how many active rules target their scope;
 * this module encapsulates the rule-filtering logic so each widget
 * stays at ~3 lines of boilerplate.
 *
 * The pure `countMatchingRules` function is exported separately so
 * tests can drive it directly without React state / TanStack Query.
 *
 * Widget usage:
 *   const { count, open, openModal, closeModal } =
 *     useRuleCount({ scope: `guest:${vmid}`, metric: 'guest.cpu' });
 *   // render <AlertBell rulesCount={count} onClick={openModal} />
 *   // render <AlertRuleModal open={open} onClose={closeModal} draft={...} />
 *
 * Scope filter matches the spirit of `rule-matcher.ts:scopeMatches` —
 * a rule targets this widget when its scope equals the widget scope OR
 * is a prefix terminated by `:` (deeper sub-scope) or `-` (node/vmid
 * hostname suffix). A rule with an empty scope (matches any) is NOT
 * counted here: the bell UX is about rules that specifically target
 * this widget's subject.
 */

import { useMemo, useState } from 'react';
import { useRules } from '@/hooks/use-notifications';
import type { EventKind, Rule } from './types.ts';

export interface RuleCountInput {
  /** Event-scope string (matches RuleMatch.scope). `guest:100`, `node:pve-01`, etc. */
  scope: string;
  /**
   * Metric name — narrows to rules whose eventKind is
   * `metric.threshold.crossed` AND whose metric equals this string.
   */
  metric?: string;
  /** Event kind — narrows to rules whose eventKind equals this literal. */
  eventKind?: EventKind;
}

export interface RuleCountState {
  count: number;
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

/**
 * Pure predicate — counts rules that would target a widget with the
 * given scope + metric/eventKind. No React, no queries; callers pass
 * the already-fetched rule list.
 */
export function countMatchingRules(
  rules: readonly Rule[],
  input: RuleCountInput,
): number {
  return rules.filter((r) => {
    if (!r.enabled) return false;
    // Scope: exact OR prefix-with-boundary (`:` or `-`). Rules with an
    // empty scope are intentionally not counted — the bell represents
    // "rules specifically targeting this subject".
    if (
      r.match.scope &&
      r.match.scope !== input.scope &&
      !input.scope.startsWith(r.match.scope + ':') &&
      !input.scope.startsWith(r.match.scope + '-')
    ) {
      return false;
    }
    // Threshold widgets: narrow to metric.threshold.crossed + exact metric.
    if (input.metric && r.match.eventKind === 'metric.threshold.crossed') {
      return r.match.metric === input.metric;
    }
    // Event-kind widgets: exact eventKind match.
    if (input.eventKind) {
      return r.match.eventKind === input.eventKind;
    }
    return false;
  }).length;
}

export function useRuleCount(input: RuleCountInput): RuleCountState {
  const { data: rules = [] } = useRules();
  const [open, setOpen] = useState(false);

  // Destructure scalar fields so the dep array is literal (input itself
  // is a fresh object every render; we want structural deps).
  const { scope, metric, eventKind } = input;
  const count = useMemo(
    () => countMatchingRules(rules, { scope, metric, eventKind }),
    [rules, scope, metric, eventKind],
  );

  return {
    count,
    open,
    openModal: () => setOpen(true),
    closeModal: () => setOpen(false),
  };
}

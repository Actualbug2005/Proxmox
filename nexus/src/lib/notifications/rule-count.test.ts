/**
 * Pure-predicate tests for countMatchingRules. The hook that wraps
 * this (`useRuleCount`) pulls the rule list from TanStack Query and
 * carries modal open/close state — those bits are exercised
 * indirectly via the widgets themselves; the filter logic is all
 * here.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { countMatchingRules } from './rule-count.ts';
import type {
  DestinationId,
  Rule,
  RuleId,
  RuleMatch,
} from './types.ts';

function rule(match: RuleMatch, overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule_test' as RuleId,
    name: 'test',
    enabled: true,
    match,
    destinationId: 'dest_test' as DestinationId,
    messageTemplate: '',
    consecutiveFires: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('countMatchingRules', () => {
  it('returns 0 for an empty rule list', () => {
    const n = countMatchingRules([], {
      scope: 'guest:100',
      metric: 'guest.cpu',
    });
    assert.equal(n, 0);
  });

  it('excludes disabled rules', () => {
    const rules: Rule[] = [
      rule(
        { eventKind: 'metric.threshold.crossed', metric: 'guest.cpu', scope: 'guest:100' },
        { enabled: false },
      ),
      rule({ eventKind: 'metric.threshold.crossed', metric: 'guest.cpu', scope: 'guest:100' }),
    ];
    const n = countMatchingRules(rules, {
      scope: 'guest:100',
      metric: 'guest.cpu',
    });
    assert.equal(n, 1);
  });

  it('counts rules with an exact scope match', () => {
    const rules: Rule[] = [
      rule({ eventKind: 'metric.threshold.crossed', metric: 'guest.cpu', scope: 'guest:100' }),
      rule({ eventKind: 'metric.threshold.crossed', metric: 'guest.cpu', scope: 'guest:101' }),
    ];
    const n = countMatchingRules(rules, {
      scope: 'guest:100',
      metric: 'guest.cpu',
    });
    assert.equal(n, 1);
  });

  it('counts rules whose scope is a colon-boundary prefix of the widget scope', () => {
    // A rule scoped to "node:pve" should count on a widget scoped to
    // "node:pve:100" (deeper sub-scope).
    const rules: Rule[] = [
      rule({ eventKind: 'guest.disk.filling', scope: 'node:pve' }),
    ];
    const n = countMatchingRules(rules, {
      scope: 'node:pve:100',
      eventKind: 'guest.disk.filling',
    });
    assert.equal(n, 1);
  });

  it('counts rules whose scope is a hyphen-boundary prefix of the widget scope', () => {
    // "node:pve" should count on "node:pve-01" (homelab hostname suffix).
    const rules: Rule[] = [
      rule({ eventKind: 'guest.disk.filling', scope: 'node:pve' }),
    ];
    const n = countMatchingRules(rules, {
      scope: 'node:pve-01',
      eventKind: 'guest.disk.filling',
    });
    assert.equal(n, 1);
  });

  it('does NOT count numeric-prefix collisions', () => {
    // "guest:100" must not match "guest:1000" — neither `:` nor `-`
    // follows the rule scope in the widget scope.
    const rules: Rule[] = [
      rule({ eventKind: 'metric.threshold.crossed', metric: 'guest.cpu', scope: 'guest:100' }),
    ];
    const n = countMatchingRules(rules, {
      scope: 'guest:1000',
      metric: 'guest.cpu',
    });
    assert.equal(n, 0);
  });

  it('metric filter narrows to the exact metric name', () => {
    const rules: Rule[] = [
      rule({ eventKind: 'metric.threshold.crossed', metric: 'guest.cpu', scope: 'guest:100' }),
      rule({ eventKind: 'metric.threshold.crossed', metric: 'guest.mem', scope: 'guest:100' }),
    ];
    const n = countMatchingRules(rules, {
      scope: 'guest:100',
      metric: 'guest.cpu',
    });
    assert.equal(n, 1);
  });

  it('eventKind filter matches only pushed-event rules of that kind', () => {
    const rules: Rule[] = [
      rule({ eventKind: 'guest.service.failed', scope: 'guest:100' }),
      rule({ eventKind: 'guest.disk.filling', scope: 'guest:100' }),
    ];
    const n = countMatchingRules(rules, {
      scope: 'guest:100',
      eventKind: 'guest.service.failed',
    });
    assert.equal(n, 1);
  });
});

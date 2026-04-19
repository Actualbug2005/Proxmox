/**
 * The rule matcher is the heart of the engine — if it lets an event
 * through when it shouldn't, an operator gets pager-spam; if it drops
 * one it should catch, a real incident goes unnoticed. Pin every
 * criterion branch explicitly.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  matchesEvent,
  rulesForEvent,
  contextFor,
} from './rule-matcher.ts';
import type {
  NotificationEvent,
  Rule,
  DestinationId,
  RuleId,
  RuleMatch,
} from './types.ts';

function pushed(
  kind: Exclude<NotificationEvent['kind'], 'metric.threshold.crossed'>,
  payload: Record<string, string | number | boolean> = {},
): NotificationEvent {
  return { kind, at: 0, payload } as NotificationEvent;
}

function metric(
  metric: string,
  value: number,
  scope = 'cluster',
): NotificationEvent {
  return {
    kind: 'metric.threshold.crossed',
    at: 0,
    metric,
    value,
    scope,
  };
}

function rule(id: string, enabled: boolean, match: RuleMatch): Rule {
  return {
    id: id as RuleId,
    name: id,
    enabled,
    match,
    destinationId: 'dest_deadbeef-dead-beef-dead-beefdeadbeef' as DestinationId,
    messageTemplate: '',
    consecutiveFires: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('matchesEvent — kind gate', () => {
  it('mismatched kind is an immediate false', () => {
    const ev = pushed('pve.renewal.failed');
    assert.equal(matchesEvent({ eventKind: 'scheduler.fire.failed' }, ev), false);
    assert.equal(matchesEvent({ eventKind: 'pve.renewal.failed' }, ev), true);
  });
});

describe('matchesEvent — scope filter', () => {
  it('substring-matches against a metric event scope', () => {
    const ev = metric('cpu.node.max', 0.9, 'node:pve-01');
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: 'node:pve' }, ev),
      true,
    );
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: 'node:pve-02' }, ev),
      false,
    );
  });

  it('derives node scope from pushed event payload', () => {
    const ev = pushed('scheduler.fire.failed', { node: 'pve-01', source: 'scripts', id: 'job-42' });
    assert.equal(
      matchesEvent({ eventKind: 'scheduler.fire.failed', scope: 'node:pve' }, ev),
      true,
    );
  });

  it('empty scope on the rule matches everything', () => {
    const ev = pushed('pve.renewal.failed');
    assert.equal(matchesEvent({ eventKind: 'pve.renewal.failed', scope: '' }, ev), true);
    assert.equal(matchesEvent({ eventKind: 'pve.renewal.failed' }, ev), true);
  });
});

describe('matchesEvent — scope boundary (numeric-prefix collision)', () => {
  it('exact guest:<vmid> match passes', () => {
    const ev = metric('guest.cpu', 0.9, 'guest:100');
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: 'guest:100' }, ev),
      true,
    );
  });

  it('guest:100 does NOT match guest:1000 (numeric-prefix collision rejected)', () => {
    const ev = metric('guest.cpu', 0.9, 'guest:1000');
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: 'guest:100' }, ev),
      false,
    );
    const ev2 = metric('guest.mem', 0.9, 'guest:1001');
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: 'guest:100' }, ev2),
      false,
    );
  });

  it('regression guard: node:pve still matches node:pve-01 (non-digit boundary)', () => {
    const ev = metric('cpu.node.max', 0.9, 'node:pve-01');
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: 'node:pve' }, ev),
      true,
    );
  });

  it('numeric rule scope still matches when next char is a non-digit delimiter', () => {
    // Hypothetical future per-disk sub-scope: `guest:100:disk-0`. A rule
    // scoped `guest:100` must still catch it because `:` is a boundary.
    const ev = metric('guest.disk', 0.9, 'guest:100:disk-0');
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: 'guest:100' }, ev),
      true,
    );
  });

  it('empty / undefined scope on the rule matches any scope (including numeric)', () => {
    const ev = metric('guest.cpu', 0.9, 'guest:1000');
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed', scope: '' }, ev),
      true,
    );
    assert.equal(
      matchesEvent({ eventKind: 'metric.threshold.crossed' }, ev),
      true,
    );
  });
});

describe('matchesEvent — metric threshold', () => {
  const ev = metric('cpu.node.max', 0.85);
  it('compares value against threshold using the chosen op', () => {
    const m = (op: '>' | '<' | '>=' | '<=', t: number): RuleMatch => ({
      eventKind: 'metric.threshold.crossed',
      metric: 'cpu.node.max',
      op,
      threshold: t,
    });
    assert.equal(matchesEvent(m('>',  0.80), ev), true);
    assert.equal(matchesEvent(m('>',  0.90), ev), false);
    assert.equal(matchesEvent(m('>=', 0.85), ev), true);
    assert.equal(matchesEvent(m('<=', 0.85), ev), true);
  });
  it('mismatched metric name is an immediate false even if op+threshold hold', () => {
    const m: RuleMatch = {
      eventKind: 'metric.threshold.crossed',
      metric: 'mem.node.max',
      op: '>',
      threshold: 0.1,
    };
    assert.equal(matchesEvent(m, ev), false);
  });
});

describe('rulesForEvent', () => {
  const ev = pushed('pve.renewal.failed');
  const enabled  = rule('rule_a', true,  { eventKind: 'pve.renewal.failed' });
  const disabled = rule('rule_b', false, { eventKind: 'pve.renewal.failed' });
  const wrong    = rule('rule_c', true,  { eventKind: 'scheduler.fire.failed' });

  it('only returns enabled rules whose predicate matches', () => {
    const got = rulesForEvent([enabled, disabled, wrong], ev);
    assert.deepEqual(got.map((r) => r.id), ['rule_a']);
  });
});

describe('contextFor', () => {
  it('exposes metric-specific keys on metric events', () => {
    const ctx = contextFor(metric('cpu.node.max', 0.87, 'node:pve'));
    assert.equal(ctx.metric, 'cpu.node.max');
    assert.equal(ctx.value, 0.87);
    assert.equal(ctx.scope, 'node:pve');
    assert.equal(ctx.kind, 'metric.threshold.crossed');
  });
  it('merges payload keys onto the base context for pushed events', () => {
    const ctx = contextFor(pushed('scheduler.fire.failed', { source: 'chains', id: 'x' }));
    assert.equal(ctx.source, 'chains');
    assert.equal(ctx.id, 'x');
    assert.equal(ctx.kind, 'scheduler.fire.failed');
  });
});

/**
 * Validator tests — the trust boundary between browser JSON and the
 * notifications engine. A loosened regex or a forgotten branch here
 * means a hostile payload could reach the store; pin every reject /
 * accept path.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  parseDestinationInput,
  parseDestinationPatch,
  parseRuleInput,
  parseRulePatch,
} from './validators.ts';

describe('parseDestinationInput — webhook', () => {
  it('accepts a valid HTTPS webhook', () => {
    const r = parseDestinationInput({
      name: 'Ops',
      config: { kind: 'webhook', url: 'https://rx.example/in' },
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.config.kind, 'webhook');
  });
  it('refuses http:// destination URLs to protect the HMAC', () => {
    const r = parseDestinationInput({
      name: 'Ops',
      config: { kind: 'webhook', url: 'http://rx.example/in' },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /https/i);
  });
  it('refuses a webhook URL that isn\'t a URL', () => {
    const r = parseDestinationInput({
      name: 'Ops', config: { kind: 'webhook', url: 'not-a-url' },
    });
    assert.equal(r.ok, false);
  });
});

describe('parseDestinationInput — ntfy', () => {
  it('accepts topic URL + basic auth "user:pass"', () => {
    const r = parseDestinationInput({
      name: 'P',
      config: { kind: 'ntfy', topicUrl: 'https://ntfy.sh/topic', basicAuth: 'me:hunter2' },
    });
    assert.equal(r.ok, true);
  });
  it('refuses basicAuth without a colon — not a valid user:pass', () => {
    const r = parseDestinationInput({
      name: 'P',
      config: { kind: 'ntfy', topicUrl: 'https://ntfy.sh/topic', basicAuth: 'nouser-password' },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /user:password/);
  });
});

describe('parseDestinationInput — discord', () => {
  it('accepts the canonical Discord webhook URL shape', () => {
    const r = parseDestinationInput({
      name: 'D',
      config: { kind: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
    });
    assert.equal(r.ok, true);
  });
  it('refuses a URL missing /api/webhooks/ — catches fat-finger mistakes', () => {
    const r = parseDestinationInput({
      name: 'D',
      config: { kind: 'discord', webhookUrl: 'https://discord.com/webhooks/123' },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Discord webhook/);
  });
});

describe('parseDestinationInput — unknown / malformed', () => {
  it('refuses an unknown kind', () => {
    const r = parseDestinationInput({
      name: 'x', config: { kind: 'slack', url: 'https://example.com' },
    });
    assert.equal(r.ok, false);
  });
  it('refuses a missing name', () => {
    const r = parseDestinationInput({
      config: { kind: 'webhook', url: 'https://example.com' },
    });
    assert.equal(r.ok, false);
  });
});

describe('parseDestinationPatch', () => {
  it('accepts empty patch', () => {
    const r = parseDestinationPatch({});
    assert.equal(r.ok, true);
  });
  it('accepts name-only patch', () => {
    const r = parseDestinationPatch({ name: 'renamed' });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.name, 'renamed');
  });
  it('validates nested config when present', () => {
    const r = parseDestinationPatch({
      config: { kind: 'webhook', url: 'http://insecure.example' },
    });
    assert.equal(r.ok, false);
  });
});

describe('parseRuleInput', () => {
  const baseInput = {
    name: 'renew alerts',
    destinationId: 'dest_abc',
    messageTemplate: 'PVE ticket renewal failed: {{reason}}',
    match: { eventKind: 'pve.renewal.failed' },
  };

  it('accepts a minimal pushed-event rule', () => {
    const r = parseRuleInput(baseInput);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.enabled, true, 'enabled defaults to true');
      assert.equal(r.value.resolvePolicy, undefined);
      assert.equal(r.value.backoff, undefined);
    }
  });

  it('accepts a metric-threshold rule with op + threshold + scope', () => {
    const r = parseRuleInput({
      ...baseInput,
      match: {
        eventKind: 'metric.threshold.crossed',
        metric: 'node.cpu.max',
        op: '>',
        threshold: 0.85,
        scope: 'node:pve',
      },
    });
    assert.equal(r.ok, true);
    if (r.ok && r.value.match.eventKind === 'metric.threshold.crossed') {
      assert.equal(r.value.match.metric, 'node.cpu.max');
      assert.equal(r.value.match.threshold, 0.85);
    }
  });

  it('silently drops metric fields on non-metric kinds rather than 400ing', () => {
    const r = parseRuleInput({
      ...baseInput,
      match: {
        eventKind: 'pve.renewal.failed',
        metric: 'node.cpu.max', // irrelevant but not hostile
        op: '>',
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal((r.value.match as { metric?: string }).metric, undefined);
      assert.equal((r.value.match as { op?: string }).op, undefined);
    }
  });

  it('refuses an unknown event kind', () => {
    const r = parseRuleInput({
      ...baseInput, match: { eventKind: 'cosmic.rays.flipped' },
    });
    assert.equal(r.ok, false);
  });

  it('refuses unknown op and non-finite threshold', () => {
    const badOp = parseRuleInput({
      ...baseInput,
      match: { eventKind: 'metric.threshold.crossed', op: '===', threshold: 0.5 },
    });
    assert.equal(badOp.ok, false);
    const badThresh = parseRuleInput({
      ...baseInput,
      match: { eventKind: 'metric.threshold.crossed', op: '>', threshold: 'a-lot' },
    });
    assert.equal(badThresh.ok, false);
  });

  it('accepts custom backoff intervals in a valid range', () => {
    const r = parseRuleInput({
      ...baseInput,
      backoff: { curve: 'custom', customIntervalsMin: [0, 2, 5, 15] },
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value.backoff?.customIntervalsMin, [0, 2, 5, 15]);
  });

  it('refuses custom backoff that is empty or contains absurd values', () => {
    const empty = parseRuleInput({
      ...baseInput, backoff: { curve: 'custom', customIntervalsMin: [] },
    });
    assert.equal(empty.ok, false);
    const neg = parseRuleInput({
      ...baseInput, backoff: { curve: 'custom', customIntervalsMin: [0, -1] },
    });
    assert.equal(neg.ok, false);
    // 25 hours — over the 1440-minute cap.
    const absurd = parseRuleInput({
      ...baseInput, backoff: { curve: 'custom', customIntervalsMin: [1500] },
    });
    assert.equal(absurd.ok, false);
  });

  it('accepts each resolvePolicy literal and refuses any other string', () => {
    for (const p of ['always', 'multi-fire', 'never']) {
      const r = parseRuleInput({ ...baseInput, resolvePolicy: p });
      assert.equal(r.ok, true, `policy=${p}`);
    }
    const bad = parseRuleInput({ ...baseInput, resolvePolicy: 'maybe' });
    assert.equal(bad.ok, false);
  });
});

describe('parseRulePatch', () => {
  it('accepts partial updates, refuses invalid nested fields', () => {
    assert.equal(parseRulePatch({ enabled: false }).ok, true);
    assert.equal(parseRulePatch({ match: { eventKind: 'nope' } }).ok, false);
  });
});

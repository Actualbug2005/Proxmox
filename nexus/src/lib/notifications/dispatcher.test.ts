/**
 * End-to-end dispatcher tests. Wires a real store + real backoff + real
 * matcher + a stubbed fetcher so we can observe:
 *   - matching events produce HTTP calls,
 *   - non-matching events don't,
 *   - backoff cooldown suppresses a second fire,
 *   - a transport failure doesn't advance the backoff clock (next
 *     event still fires immediately).
 *
 * Phase A's tests covered the pure helpers; this file is specifically
 * the choreography glue.
 */
process.env.JWT_SECRET = 'notifications-dispatcher-test-0123456789abcdef';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const TMP = mkdtempSync(join(tmpdir(), 'nexus-notif-disp-'));
process.env.NEXUS_DATA_DIR = TMP;

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

const store = await import('./store.ts');
const dispatcher = await import('./dispatcher.ts');
import type { DispatchFetcher } from './destinations/types.ts';
import type { NotificationEvent } from './types.ts';

function captureFetcher(response = { ok: true, status: 200, statusText: 'OK' }) {
  const calls: Array<{ url: string }> = [];
  const fetcher: DispatchFetcher = async (url) => {
    calls.push({ url });
    return response;
  };
  return { fetcher, calls };
}

async function seedRule(over: {
  url?: string;
  eventKind?: NotificationEvent['kind'];
  template?: string;
  backoff?: Parameters<typeof store.createRule>[0]['match'] extends unknown
    ? Parameters<typeof store.createRule>[0] extends { backoff?: infer B }
      ? B
      : never
    : never;
} = {}) {
  const dest = await store.createDestination({
    name: 'webhook',
    config: { kind: 'webhook', url: over.url ?? 'https://rx.example/in' },
  });
  const r = await store.createRule({
    name: 'rule-1',
    match: { eventKind: over.eventKind ?? 'pve.renewal.failed' },
    destinationId: dest.id,
    messageTemplate: over.template ?? 'renewal failed for {{username}}',
  });
  return { dest, rule: r };
}

function event(
  kind: NotificationEvent['kind'] = 'pve.renewal.failed',
  at = Date.now(),
): NotificationEvent {
  if (kind === 'metric.threshold.crossed') {
    return { kind, at, metric: 'cpu.node.max', value: 0.9, scope: 'node:pve' };
  }
  return { kind, at, payload: { username: 'root@pam' } };
}

beforeEach(async () => {
  await store.__testing.reset();
  dispatcher.__testing.clearRing();
});

describe('handleEvent', () => {
  it('matching event dispatches to the rule\'s destination', async () => {
    const { rule } = await seedRule();
    const { fetcher, calls } = captureFetcher();
    await dispatcher.handleEvent(event(), { fetcher });
    assert.equal(calls.length, 1);
    const updated = await store.getRule(rule.id);
    assert.equal(updated?.consecutiveFires, 1, 'backoff advanced on success');
    assert.ok(updated?.lastFireAt);
    assert.ok(updated?.nextEligibleAt);
  });

  it('non-matching event produces no dispatch', async () => {
    await seedRule({ eventKind: 'scheduler.fire.failed' });
    const { fetcher, calls } = captureFetcher();
    await dispatcher.handleEvent(event('pve.renewal.failed'), { fetcher });
    assert.equal(calls.length, 0);
  });

  it('cooldown suppresses a second fire within the window', async () => {
    const { rule } = await seedRule();
    const { fetcher, calls } = captureFetcher();
    const t0 = 1_000_000;
    await dispatcher.handleEvent(event('pve.renewal.failed', t0), { fetcher, now: () => t0 });
    // Gentle curve[1] = 5 min cooldown. Fire again 1 min later — skip.
    const t1 = t0 + 60_000;
    await dispatcher.handleEvent(event('pve.renewal.failed', t1), { fetcher, now: () => t1 });
    assert.equal(calls.length, 1, 'second event inside cooldown did not reach transport');
    const updated = await store.getRule(rule.id);
    assert.equal(updated?.consecutiveFires, 1, 'backoff did not advance on a skipped event');
  });

  it('transport failure does NOT advance backoff — next event retries', async () => {
    const { rule } = await seedRule();
    const { fetcher } = captureFetcher({ ok: false, status: 502, statusText: 'Bad Gateway' });
    const t0 = 1_000_000;
    await dispatcher.handleEvent(event('pve.renewal.failed', t0), { fetcher, now: () => t0 });
    const afterFail = await store.getRule(rule.id);
    assert.equal(
      afterFail?.consecutiveFires,
      0,
      'consecutiveFires unchanged after a failed dispatch',
    );
    assert.equal(afterFail?.lastFireAt, undefined);

    // A successful retry on the next event should fire fresh.
    const { fetcher: ok, calls } = captureFetcher();
    await dispatcher.handleEvent(event('pve.renewal.failed', t0 + 100), { fetcher: ok, now: () => t0 + 100 });
    assert.equal(calls.length, 1);
    const afterOk = await store.getRule(rule.id);
    assert.equal(afterOk?.consecutiveFires, 1);
  });

  it('renders the template against the event payload', async () => {
    await seedRule({ template: 'failed: {{username}}' });
    let captured = '';
    const fetcher: DispatchFetcher = async (_url, init) => {
      const parsed = JSON.parse(init.body) as { message: string };
      captured = parsed.message;
      return { ok: true, status: 200, statusText: 'OK' };
    };
    await dispatcher.handleEvent(event(), { fetcher });
    assert.equal(captured, 'failed: root@pam');
  });

  it('propagates __resolve from the event to payload.resolved', async () => {
    await seedRule({ eventKind: 'metric.threshold.crossed' });
    let captured: Record<string, unknown> = {};
    const fetcher: DispatchFetcher = async (_url, init) => {
      captured = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 200, statusText: 'OK' };
    };
    const resolveEvt: NotificationEvent = {
      kind: 'metric.threshold.crossed',
      at: Date.now(),
      metric: 'cpu.node.max',
      value: 0,
      scope: 'node:pve',
      __resolve: true,
    };
    await dispatcher.handleEvent(resolveEvt, { fetcher });
    assert.equal(captured.resolved, true, 'webhook body carries resolved:true');
  });

  it('omits payload.resolved when __resolve is absent', async () => {
    await seedRule({ eventKind: 'metric.threshold.crossed' });
    let captured: Record<string, unknown> = {};
    const fetcher: DispatchFetcher = async (_url, init) => {
      captured = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 200, statusText: 'OK' };
    };
    const firingEvt: NotificationEvent = {
      kind: 'metric.threshold.crossed',
      at: Date.now(),
      metric: 'cpu.node.max',
      value: 0.95,
      scope: 'node:pve',
    };
    await dispatcher.handleEvent(firingEvt, { fetcher });
    assert.equal(
      'resolved' in captured,
      false,
      'firing alert body has no resolved key',
    );
  });
});

describe('recentDispatches', () => {
  it('records skipped + sent outcomes', async () => {
    await seedRule();
    const { fetcher } = captureFetcher();
    const t0 = 1_000_000;
    await dispatcher.handleEvent(event('pve.renewal.failed', t0), { fetcher, now: () => t0 });
    await dispatcher.handleEvent(event('pve.renewal.failed', t0 + 1000), { fetcher, now: () => t0 + 1000 });
    const recent = dispatcher.recentDispatches(10);
    const outcomes = recent.map((r) => r.outcome).sort();
    assert.deepEqual(outcomes, ['sent', 'skipped']);
  });
});

process.on('exit', () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

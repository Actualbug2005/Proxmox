/**
 * Transport-level tests. Each destination has its own HTTP shape the
 * receiver cares about — we pin the headers + body contents here so a
 * future refactor can't silently break an operator's webhook receiver.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import { dispatch as webhook } from './webhook.ts';
import { dispatch as ntfy } from './ntfy.ts';
import { dispatch as discord } from './discord.ts';
import type { DispatchFetcher, DispatchPayload } from './types.ts';

// Generated per run so no credential-shaped string ever lives in source.
// This is a test fixture, not a hardcoded secret.
const TEST_HMAC_KEY = randomBytes(32).toString('hex');

function captureFetcher(response: { ok: boolean; status: number; statusText: string } = {
  ok: true, status: 200, statusText: 'OK',
}) {
  const calls: Array<{ url: string; init: Parameters<DispatchFetcher>[1] }> = [];
  const fetcher: DispatchFetcher = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { fetcher, calls };
}

function samplePayload(over: Partial<DispatchPayload> = {}): DispatchPayload {
  return {
    kind: 'pve.renewal.failed',
    at: Date.parse('2026-04-18T12:00:00.000Z'),
    message: 'PVE ticket renewal failed for root@pam',
    ...over,
  };
}

describe('webhook dispatch', () => {
  it('POSTs JSON with standard headers and no signature when hmacSecret is absent', async () => {
    const { fetcher, calls } = captureFetcher();
    const res = await webhook({ kind: 'webhook', url: 'https://rx/in' }, samplePayload(), fetcher);
    assert.equal(res.outcome, 'sent');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://rx/in');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.ok(!('X-Nexus-Signature' in calls[0].init.headers), 'no signature header without a secret');
  });

  it('signs the body with HMAC-SHA-256 when hmacSecret is set', async () => {
    const { fetcher, calls } = captureFetcher();
    await webhook(
      { kind: 'webhook', url: 'https://rx/in', hmacSecret: TEST_HMAC_KEY },
      samplePayload(),
      fetcher,
    );
    const sig = calls[0].init.headers['X-Nexus-Signature'];
    assert.ok(sig?.startsWith('sha256='), 'header uses the sha256= prefix');
    const want = 'sha256=' + createHmac('sha256', TEST_HMAC_KEY).update(calls[0].init.body).digest('hex');
    assert.equal(sig, want, 'signature is HMAC-SHA-256 of the raw request body');
  });

  it('reports HTTP failure rather than throwing', async () => {
    const { fetcher } = captureFetcher({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const res = await webhook({ kind: 'webhook', url: 'https://rx/in' }, samplePayload(), fetcher);
    assert.equal(res.outcome, 'failed');
    assert.equal(res.status, 503);
    assert.match(res.reason ?? '', /503/);
  });
});

describe('ntfy dispatch', () => {
  it('sends plain-text body with ntfy-specific headers', async () => {
    const { fetcher, calls } = captureFetcher();
    await ntfy(
      { kind: 'ntfy', topicUrl: 'https://ntfy.sh/test-topic' },
      samplePayload({ title: 'Renewal' }),
      fetcher,
    );
    const { init, url } = calls[0];
    assert.equal(url, 'https://ntfy.sh/test-topic');
    assert.equal(init.body, 'PVE ticket renewal failed for root@pam');
    assert.equal(init.headers.Title, 'Renewal');
    assert.equal(init.headers.Priority, 'high', 'alert → high priority');
    assert.equal(init.headers.Tags, 'warning');
  });

  it('dials priority down + flips the tag when the payload is a resolve', async () => {
    const { fetcher, calls } = captureFetcher();
    await ntfy(
      { kind: 'ntfy', topicUrl: 'https://ntfy.sh/x' },
      samplePayload({ resolved: true }),
      fetcher,
    );
    assert.equal(calls[0].init.headers.Priority, 'default');
    assert.equal(calls[0].init.headers.Tags, 'white_check_mark');
  });

  it('base64-encodes Basic-auth pair at dispatch time (not on disk)', async () => {
    const { fetcher, calls } = captureFetcher();
    await ntfy(
      { kind: 'ntfy', topicUrl: 'https://ntfy.sh/x', basicAuth: 'op:hunter2' },
      samplePayload(),
      fetcher,
    );
    const header = calls[0].init.headers.Authorization;
    assert.equal(header, 'Basic ' + Buffer.from('op:hunter2').toString('base64'));
  });
});

describe('discord dispatch', () => {
  it('POSTs an embed with alert colour and the kind in the footer', async () => {
    const { fetcher, calls } = captureFetcher();
    await discord(
      { kind: 'discord', webhookUrl: 'https://discord.com/api/webhooks/abc' },
      samplePayload({ title: 'PVE down' }),
      fetcher,
    );
    const parsed = JSON.parse(calls[0].init.body) as {
      embeds: Array<{ color: number; description: string; footer: { text: string }; title: string }>;
    };
    assert.equal(parsed.embeds[0].title, 'PVE down');
    assert.equal(parsed.embeds[0].color, 0xdc2626, 'alert renders red');
    assert.match(parsed.embeds[0].footer.text, /pve\.renewal\.failed/);
  });

  it('flips to resolve colour when payload.resolved is true', async () => {
    const { fetcher, calls } = captureFetcher();
    await discord(
      { kind: 'discord', webhookUrl: 'https://discord.com/api/webhooks/abc' },
      samplePayload({ resolved: true }),
      fetcher,
    );
    const parsed = JSON.parse(calls[0].init.body) as { embeds: Array<{ color: number }> };
    assert.equal(parsed.embeds[0].color, 0x10b981, 'resolve renders green');
  });

  it('truncates oversize bodies with an ellipsis so we stay under Discord limits', async () => {
    const { fetcher, calls } = captureFetcher();
    const huge = 'A'.repeat(5000);
    await discord(
      { kind: 'discord', webhookUrl: 'https://discord.com/api/webhooks/abc' },
      samplePayload({ message: huge }),
      fetcher,
    );
    const parsed = JSON.parse(calls[0].init.body) as { embeds: Array<{ description: string }> };
    assert.ok(parsed.embeds[0].description.length <= 1900);
    assert.ok(parsed.embeds[0].description.endsWith('…'));
  });
});

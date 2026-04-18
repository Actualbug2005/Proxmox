/**
 * Persistence + encrypt-on-write invariants for the notifications store.
 * JWT_SECRET + NEXUS_DATA_DIR must both be set before import because
 * the crypto module and the store both load env eagerly.
 */
process.env.JWT_SECRET = 'notifications-store-test-0123456789abcdef';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const TMP = mkdtempSync(join(tmpdir(), 'nexus-notif-store-'));
process.env.NEXUS_DATA_DIR = TMP;

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';

const store = await import('./store.ts');

// Grab a known-valid WebhookDestination config.
function sampleWebhook() {
  return {
    kind: 'webhook' as const,
    url: 'https://example.com/in',
    hmacSecret: 'some-shared-secret',
  };
}

beforeEach(async () => {
  await store.__testing.reset();
});

describe('destination lifecycle', () => {
  it('creates, lists, decrypts, updates, removes', async () => {
    const created = await store.createDestination({
      name: 'Ops webhook',
      config: sampleWebhook(),
    });
    assert.match(created.id, /^dest_[0-9a-f-]{36}$/);
    assert.equal(created.kind, 'webhook');
    assert.equal(typeof created.secretBlob, 'string');

    const listed = await store.listDestinations();
    assert.equal(listed.length, 1);
    assert.deepEqual(store.decryptDestination(listed[0]), sampleWebhook());

    const updated = await store.updateDestination(created.id, {
      name: 'Ops webhook (renamed)',
    });
    assert.equal(updated?.name, 'Ops webhook (renamed)');
    // Unchanged config should round-trip cleanly.
    assert.deepEqual(store.decryptDestination(updated!), sampleWebhook());

    const ok = await store.removeDestination(created.id);
    assert.equal(ok, true);
    assert.equal((await store.listDestinations()).length, 0);
  });

  it('persists ciphertext only — the plaintext URL never hits disk', async () => {
    const d = await store.createDestination({
      name: 'leak-test',
      config: {
        kind: 'webhook',
        url: 'https://super-secret-receiver.example/in',
      },
    });
    const raw = readFileSync(store.__testing.dataPath(), 'utf8');
    assert.ok(raw.includes(d.id), 'id is in plaintext');
    assert.ok(!raw.includes('super-secret-receiver.example'),
      'URL must be encrypted, not in the on-disk JSON');
  });

  it('removeDestination cascades — rules pointing to it are dropped', async () => {
    const d = await store.createDestination({ name: 'A', config: sampleWebhook() });
    await store.createRule({
      name: 'r1',
      match: { eventKind: 'pve.renewal.failed' },
      destinationId: d.id,
      messageTemplate: 'renewal blew up',
    });
    assert.equal((await store.listRules()).length, 1);
    await store.removeDestination(d.id);
    assert.equal((await store.listRules()).length, 0,
      'orphaned rule was cascade-deleted');
  });
});

describe('rule lifecycle', () => {
  it('refuses to create a rule pointing at a missing destination', async () => {
    await assert.rejects(
      store.createRule({
        name: 'x',
        match: { eventKind: 'pve.renewal.failed' },
        destinationId: 'dest_00000000-0000-0000-0000-000000000000' as never,
        messageTemplate: 'nope',
      }),
      /does not exist/,
    );
  });

  it('markRuleFired mutates just the backoff fields, never user-supplied ones', async () => {
    const d = await store.createDestination({ name: 'x', config: sampleWebhook() });
    const r = await store.createRule({
      name: 'original',
      match: { eventKind: 'pve.renewal.failed' },
      destinationId: d.id,
      messageTemplate: 'hi',
    });
    await store.markRuleFired(r.id, {
      lastFireAt: 1234,
      nextEligibleAt: 5678,
      consecutiveFires: 2,
      firstMatchAt: 1000,
    });
    const after = await store.getRule(r.id);
    assert.equal(after?.lastFireAt, 1234);
    assert.equal(after?.nextEligibleAt, 5678);
    assert.equal(after?.consecutiveFires, 2);
    assert.equal(after?.firstMatchAt, 1000);
    assert.equal(after?.name, 'original', 'user field must not be touched');
    assert.equal(after?.messageTemplate, 'hi');
  });

  it('markRuleCleared zeroes the backoff fields and stamps clearedAt', async () => {
    const d = await store.createDestination({ name: 'x', config: sampleWebhook() });
    const r = await store.createRule({
      name: 'r',
      match: { eventKind: 'pve.renewal.failed' },
      destinationId: d.id,
      messageTemplate: '',
    });
    await store.markRuleFired(r.id, {
      lastFireAt: 1, nextEligibleAt: 2, consecutiveFires: 3, firstMatchAt: 0,
    });
    await store.markRuleCleared(r.id, 999);
    const after = await store.getRule(r.id);
    assert.equal(after?.consecutiveFires, 0);
    assert.equal(after?.nextEligibleAt, undefined);
    assert.equal(after?.firstMatchAt, undefined);
    assert.equal(after?.clearedAt, 999);
  });
});

// Tmp dir cleanup.
process.on('exit', () => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

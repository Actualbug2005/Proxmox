/**
 * Federation security invariants — locked by CI.
 *
 * These aren't feature tests; they guard against silent regressions
 * that would widen the attack surface. If any of these fail, do NOT
 * just delete the assertion; figure out what changed and whether
 * the change is safe.
 */
import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

process.env.JWT_SECRET = 'federation-invariants-test-secret-0123456789';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nexus-fed-inv-'));
  process.env.NEXUS_DATA_DIR = tmp;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.NEXUS_DATA_DIR;
});

describe('federation invariants', () => {
  it('cluster id "local" is always rejected', async () => {
    const { addCluster } = await import('@/lib/federation/store');
    await assert.rejects(
      () =>
        addCluster({
          id: 'local',
          name: 'local',
          endpoints: ['https://example:8006'],
          tokenId: 'nexus@pve!t',
          tokenSecret: 'aaaaaaaa',
        }),
      /reserved/i,
    );
  });

  it('http:// endpoints are always rejected', async () => {
    const { addCluster } = await import('@/lib/federation/store');
    await assert.rejects(
      () =>
        addCluster({
          id: 'lab',
          name: 'lab',
          endpoints: ['http://nope:8006'],
          tokenId: 'nexus@pve!t',
          tokenSecret: 'aaaaaaaa',
        }),
      /https/i,
    );
  });

  it('file-schema versions other than 1 fail open to empty list', async () => {
    const { encryptSecret } = await import('@/lib/notifications/crypto');
    await mkdir(tmp, { recursive: true });
    const blob = encryptSecret({ version: 2, clusters: [{ id: 'from-future' }] });
    await writeFile(join(tmp, 'federation.json'), blob, {
      mode: 0o600,
      encoding: 'utf8',
    });
    const { listClusters } = await import('@/lib/federation/store');
    const list = await listClusters();
    // Corrupt/unknown schema surfaces as "empty registry" — operator sees
    // no clusters rather than a half-trusted list, and the proxy's local
    // path continues to work unaffected.
    assert.deepEqual(list, []);
  });

  it('redactCluster never returns tokenSecret', async () => {
    // Lock the serializer boundary invariant. Any future serializer
    // change that accidentally spreads the RegisteredCluster (...c) or
    // returns the raw record would trip this test.
    const { addCluster } = await import('@/lib/federation/store');
    const { __resetForTests, reloadFederation } = await import(
      '@/lib/federation/session'
    );
    const { redactCluster } = await import('@/lib/federation/serialize');
    __resetForTests();
    const SECRET = 'SECRETMARKER-invariant-check-deadbeef-12345';
    const record = await addCluster({
      id: 'lab',
      name: 'Lab',
      endpoints: ['https://pve:8006'],
      tokenId: 'nexus@pve!inv',
      tokenSecret: SECRET,
    });
    await reloadFederation();
    const redacted = redactCluster(record);
    assert.ok(!('tokenSecret' in redacted), 'tokenSecret key must be absent');
    assert.equal(
      JSON.stringify(redacted).includes(SECRET),
      false,
      'secret value must not appear anywhere in the redacted shape',
    );
  });
});

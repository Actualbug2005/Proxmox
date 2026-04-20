/**
 * store.test.ts — federation registry persistence.
 *
 * Uses an isolated tmp NEXUS_DATA_DIR per test case so we exercise the
 * same resolveDataDir() lookup path the production code uses. Encrypted
 * roundtrips use the real notifications/crypto helper so corruption /
 * bad-MAC cases are exercised end-to-end.
 */
import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Secret must be set before importing the crypto helper for deterministic
// output in test context. Same pattern as service-account/store.test.ts.
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nexus-fed-'));
  process.env.NEXUS_DATA_DIR = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.NEXUS_DATA_DIR;
});

const validCluster = {
  id: 'prod-east',
  name: 'Production East',
  endpoints: ['https://pve-east-1.example.com:8006', 'https://pve-east-2.example.com:8006'],
  tokenId: 'nexus@pve!federate',
  tokenSecret: 'deadbeef-1234-5678-9abc-def012345678',
} as const;

describe('federation store', () => {
  it('round-trips a single cluster through encrypt/decrypt', async () => {
    const { addCluster, listClusters } = await import('./store.ts');
    await addCluster({ ...validCluster });
    const list = await listClusters();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'prod-east');
    assert.equal(list[0].tokenSecret, validCluster.tokenSecret);
    assert.equal(list[0].authMode, 'token');
    assert.ok(list[0].savedAt > 0);
    assert.equal(list[0].rotatedAt, list[0].savedAt);
  });

  it('rejects a reserved id (local)', async () => {
    const { addCluster } = await import('./store.ts');
    await assert.rejects(
      () => addCluster({ ...validCluster, id: 'local' }),
      /reserved/i,
    );
  });

  it('rejects malformed ids', async () => {
    const { addCluster } = await import('./store.ts');
    const bad = ['', '-foo', 'Foo', 'foo bar', 'a'.repeat(33), '.hidden', '1foo'];
    for (const id of bad) {
      await assert.rejects(
        () => addCluster({ ...validCluster, id }),
        /Invalid cluster id/i,
        `expected rejection for id="${id}"`,
      );
    }
  });

  it('rejects http:// endpoints', async () => {
    const { addCluster } = await import('./store.ts');
    await assert.rejects(
      () => addCluster({ ...validCluster, endpoints: ['http://pve.example.com:8006'] }),
      /https/i,
    );
  });

  it('rejects duplicate endpoints within one cluster', async () => {
    const { addCluster } = await import('./store.ts');
    const dup = 'https://pve-east-1.example.com:8006';
    await assert.rejects(
      () => addCluster({ ...validCluster, endpoints: [dup, dup] }),
      /duplicate/i,
    );
  });

  it('rejects too many endpoints', async () => {
    const { addCluster } = await import('./store.ts');
    const five = [
      'https://a:8006', 'https://b:8006', 'https://c:8006',
      'https://d:8006', 'https://e:8006',
    ];
    await assert.rejects(
      () => addCluster({ ...validCluster, endpoints: five }),
      /at most 4/i,
    );
  });

  it('rejects malformed tokenId', async () => {
    const { addCluster } = await import('./store.ts');
    await assert.rejects(
      () => addCluster({ ...validCluster, tokenId: 'missing-separator' }),
      /tokenId/i,
    );
  });

  it('rejects too-short tokenSecret', async () => {
    const { addCluster } = await import('./store.ts');
    await assert.rejects(
      () => addCluster({ ...validCluster, tokenSecret: 'short' }),
      /tokenSecret/i,
    );
  });

  it('returns 409 on duplicate id', async () => {
    const { addCluster } = await import('./store.ts');
    await addCluster({ ...validCluster });
    await assert.rejects(
      () => addCluster({ ...validCluster, endpoints: ['https://other:8006'] }),
      /already registered/i,
    );
  });

  it('removeCluster is idempotent', async () => {
    const { addCluster, removeCluster } = await import('./store.ts');
    await addCluster({ ...validCluster });
    const first = await removeCluster('prod-east');
    const second = await removeCluster('prod-east');
    assert.equal(first, true);
    assert.equal(second, false);
  });

  it('rotateCredentials replaces token and bumps rotatedAt', async () => {
    const { addCluster, rotateCredentials, listClusters } = await import('./store.ts');
    await addCluster({ ...validCluster });
    const before = (await listClusters())[0];
    // Ensure timestamp changes — sleep a millisecond.
    await new Promise((r) => setTimeout(r, 2));
    await rotateCredentials('prod-east', {
      tokenId: 'nexus@pve!rotated',
      tokenSecret: 'newbeef-1234-5678-9abc-def012345678',
    });
    const after = (await listClusters())[0];
    assert.equal(after.tokenId, 'nexus@pve!rotated');
    assert.equal(after.tokenSecret, 'newbeef-1234-5678-9abc-def012345678');
    assert.ok(after.rotatedAt > before.rotatedAt);
    assert.equal(after.savedAt, before.savedAt);
  });

  it('rejects load with wrong file-schema version', async () => {
    // Write a version:2 blob directly; loadAll should reject.
    const { encryptSecret } = await import('../notifications/crypto.ts');
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(tmp, { recursive: true });
    const blob = encryptSecret({ version: 2, clusters: [] });
    await writeFile(join(tmp, 'federation.json'), blob, { mode: 0o600, encoding: 'utf8' });
    const { listClusters } = await import('./store.ts');
    const list = await listClusters();
    // Corrupt/unknown schema surfaces as "empty registry" — matches the
    // service-account pattern. A critical log line is emitted (not
    // asserted here; the invariant test suite checks that separately).
    assert.deepEqual(list, []);
  });

  it('getCluster returns the record for a known id and null for unknown', async () => {
    const { addCluster, getCluster } = await import('./store.ts');
    await addCluster({ ...validCluster });
    const hit = await getCluster('prod-east');
    assert.ok(hit);
    assert.equal(hit.id, 'prod-east');
    const miss = await getCluster('not-there');
    assert.equal(miss, null);
  });
});

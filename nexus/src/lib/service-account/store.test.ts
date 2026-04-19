/**
 * Service-account store: encrypted round-trip + shape validation.
 *
 * JWT_SECRET must be set before the crypto helper loads (notifications/
 * crypto.ts caches the derived key material via env.ts). NEXUS_DATA_DIR
 * is read lazily by the store on every call, so setting it in `before()`
 * is safe — each test points the store at a fresh tmp dir.
 */
process.env.JWT_SECRET = 'service-account-store-test-0123456789abcdef';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, deleteConfig } from './store.ts';
import type { ServiceAccountConfig } from './types.ts';

let dataDir: string;
const origDataDir = process.env.NEXUS_DATA_DIR;

before(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nexus-sa-test-'));
  process.env.NEXUS_DATA_DIR = dataDir;
});

beforeEach(async () => {
  await deleteConfig().catch(() => undefined);
});

after(() => {
  if (origDataDir !== undefined) process.env.NEXUS_DATA_DIR = origDataDir;
  else delete process.env.NEXUS_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('service-account store', () => {
  it('returns null when no file exists', async () => {
    assert.equal(await loadConfig(), null);
  });

  it('round-trips a valid config', async () => {
    const cfg: ServiceAccountConfig = {
      tokenId: 'nexus@pve!automation',
      secret: 'abcd-1234-efgh-5678',
      proxmoxHost: '127.0.0.1',
      savedAt: 1700000000000,
    };
    await saveConfig(cfg);
    assert.deepEqual(await loadConfig(), cfg);
  });

  it('rejects malformed tokenId (no bang)', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'no-bang-here', secret: 'x', proxmoxHost: '127.0.0.1', savedAt: 0 }),
    );
  });

  it('rejects malformed tokenId (no @realm)', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'only!tokenname', secret: 'x', proxmoxHost: '127.0.0.1', savedAt: 0 }),
    );
  });

  it('rejects empty secret', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'nexus@pve!automation', secret: '', proxmoxHost: '127.0.0.1', savedAt: 0 }),
    );
  });

  it('rejects proxmoxHost with scheme', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'nexus@pve!automation', secret: 'x', proxmoxHost: 'http://foo', savedAt: 0 }),
    );
  });

  it('rejects proxmoxHost with path', async () => {
    await assert.rejects(() =>
      saveConfig({ tokenId: 'nexus@pve!automation', secret: 'x', proxmoxHost: '127.0.0.1/path', savedAt: 0 }),
    );
  });

  it('accepts IPv6 in brackets', async () => {
    const cfg: ServiceAccountConfig = {
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '[::1]',
      savedAt: 0,
    };
    await saveConfig(cfg);
    assert.deepEqual(await loadConfig(), cfg);
  });

  it('deleteConfig removes the file', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 0,
    });
    await deleteConfig();
    assert.equal(await loadConfig(), null);
  });
});

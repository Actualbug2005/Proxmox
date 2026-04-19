process.env.JWT_SECRET = 'service-account-session-test-0123456789abcdef';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig, deleteConfig } from './store.ts';
import {
  loadServiceAccountAtBoot,
  reloadServiceAccount,
  getServiceSession,
  getServiceAccountStatus,
} from './session.ts';

let dataDir: string;
const origDataDir = process.env.NEXUS_DATA_DIR;
let originalFetch: typeof globalThis.fetch;

before(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nexus-sa-session-'));
  process.env.NEXUS_DATA_DIR = dataDir;
  originalFetch = globalThis.fetch;
  // Default: probes succeed.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: { '/': { 'Sys.Audit': 1 } } }), { status: 200 })) as typeof fetch;
});

beforeEach(async () => {
  await deleteConfig().catch(() => undefined);
  await reloadServiceAccount(); // reset singleton to whatever the filesystem says
});

after(() => {
  globalThis.fetch = originalFetch;
  if (origDataDir !== undefined) process.env.NEXUS_DATA_DIR = origDataDir;
  else delete process.env.NEXUS_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('service-account session singleton', () => {
  it('boot with no file → null session, status.configured false', async () => {
    await loadServiceAccountAtBoot();
    assert.equal(getServiceSession(), null);
    assert.equal(getServiceAccountStatus().configured, false);
  });

  it('boot with valid file → session populated, status.configured true', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1700000000000,
    });
    await loadServiceAccountAtBoot();
    const s = getServiceSession();
    assert.ok(s);
    assert.equal(s.tokenId, 'nexus@pve!automation');
    assert.equal(getServiceAccountStatus().configured, true);
    assert.equal(getServiceAccountStatus().lastProbeOk, true);
  });

  it('reload after save replaces singleton', async () => {
    await loadServiceAccountAtBoot();
    assert.equal(getServiceSession(), null);
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1,
    });
    await reloadServiceAccount();
    assert.ok(getServiceSession());
  });

  it('deleteConfig + reload → singleton null again', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1,
    });
    await reloadServiceAccount();
    assert.ok(getServiceSession());
    await deleteConfig();
    await reloadServiceAccount();
    assert.equal(getServiceSession(), null);
    assert.equal(getServiceAccountStatus().configured, false);
  });

  it('concurrent reload calls serialise (no corrupt status)', async () => {
    await saveConfig({
      tokenId: 'nexus@pve!automation',
      secret: 'x',
      proxmoxHost: '127.0.0.1',
      savedAt: 1,
    });
    await Promise.all([reloadServiceAccount(), reloadServiceAccount(), reloadServiceAccount()]);
    assert.equal(getServiceAccountStatus().configured, true);
  });
});

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';

let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'nexus-fed-sess-'));
  process.env.NEXUS_DATA_DIR = tmp;
  // Reset module state so cross-test pollution can't mask bugs. The
  // session module holds clusters + probeStates in module scope and
  // node:test shares the module graph across describe blocks.
  const { __resetForTests } = await import('./session.ts');
  __resetForTests();
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.NEXUS_DATA_DIR;
});

describe('federation session', () => {
  it('loadFederationAtBoot primes the resolver from the store', async () => {
    const { addCluster } = await import('./store.ts');
    await addCluster({
      id: 'lab',
      name: 'Lab',
      endpoints: ['https://pve:8006'],
      tokenId: 'nexus@pve!t',
      tokenSecret: 'aaaaaaaa',
    });
    const { loadFederationAtBoot, resolveRegisteredCluster } = await import('./session.ts');
    await loadFederationAtBoot();
    const resolved = resolveRegisteredCluster('lab');
    assert.ok(resolved);
    assert.equal(resolved.id, 'lab');
    assert.equal(resolveRegisteredCluster('nope'), null);
  });

  it('reloadFederation reflects a subsequent add', async () => {
    const { loadFederationAtBoot, reloadFederation, resolveRegisteredCluster } =
      await import('./session.ts');
    await loadFederationAtBoot();
    assert.equal(resolveRegisteredCluster('late'), null);

    const { addCluster } = await import('./store.ts');
    await addCluster({
      id: 'late',
      name: 'Late',
      endpoints: ['https://pve:8006'],
      tokenId: 'nexus@pve!t',
      tokenSecret: 'aaaaaaaa',
    });
    await reloadFederation();
    assert.ok(resolveRegisteredCluster('late'));
  });

  it('getClusterProbeState returns null before any probe runs', async () => {
    const { getClusterProbeState } = await import('./session.ts');
    assert.equal(getClusterProbeState('any'), null);
  });
});

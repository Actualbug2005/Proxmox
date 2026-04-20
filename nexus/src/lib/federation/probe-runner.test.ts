/**
 * probe-runner.test.ts — fan-out tick coordination.
 *
 * The runner is parameterised on listClusters + probeOne + state so
 * we can test tick semantics without wiring in the real store.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { runProbeTick } from './probe-runner.ts';
import type { ClusterProbeState, RegisteredCluster } from './types.ts';

function cluster(id: string): RegisteredCluster {
  return {
    id,
    name: id,
    endpoints: [`https://${id}-1:8006`],
    authMode: 'token',
    tokenId: 'nexus@pve!t',
    tokenSecret: 'aaaaaaaa',
    savedAt: 0,
    rotatedAt: 0,
  };
}

const okProbe = (id: string, activeEndpoint = `https://${id}-1:8006`): ClusterProbeState => ({
  clusterId: id,
  reachable: true,
  activeEndpoint,
  latencyMs: 10,
  pveVersion: '8.2.4',
  quorate: true,
  lastProbedAt: 0,
  lastError: null,
});

describe('runProbeTick', () => {
  it('probes every registered cluster and returns states keyed by id', async () => {
    const state = new Map<string, ClusterProbeState>();
    await runProbeTick({
      listClusters: async () => [cluster('a'), cluster('b'), cluster('c')],
      probeOne: async (c) => okProbe(c.id),
      state,
    });
    assert.equal(state.size, 3);
    assert.equal(state.get('a')?.reachable, true);
    assert.equal(state.get('b')?.reachable, true);
    assert.equal(state.get('c')?.reachable, true);
  });

  it('one cluster throwing does not break the others', async () => {
    const state = new Map<string, ClusterProbeState>();
    await runProbeTick({
      listClusters: async () => [cluster('a'), cluster('boom'), cluster('c')],
      probeOne: async (c) => {
        if (c.id === 'boom') throw new Error('kaboom');
        return okProbe(c.id);
      },
      state,
    });
    assert.equal(state.get('a')?.reachable, true);
    assert.equal(state.get('c')?.reachable, true);
    const boom = state.get('boom');
    assert.ok(boom);
    assert.equal(boom.reachable, false);
    assert.match(boom.lastError ?? '', /kaboom/);
  });

  it('passes the previous activeEndpoint into the next probe call', async () => {
    const state = new Map<string, ClusterProbeState>();
    state.set('a', okProbe('a', 'https://a-2:8006'));

    let seen: string | undefined;
    await runProbeTick({
      listClusters: async () => [cluster('a')],
      probeOne: async (_c, { lastActiveEndpoint }) => {
        seen = lastActiveEndpoint;
        return okProbe('a');
      },
      state,
    });
    assert.equal(seen, 'https://a-2:8006');
  });

  it('removes stale entries for clusters that have been deregistered', async () => {
    const state = new Map<string, ClusterProbeState>();
    state.set('ghost', okProbe('ghost'));
    await runProbeTick({
      listClusters: async () => [cluster('a')],
      probeOne: async (c) => okProbe(c.id),
      state,
    });
    assert.equal(state.has('ghost'), false);
    assert.equal(state.has('a'), true);
  });

  it('does not overlap when called twice concurrently (single-flight)', async () => {
    const state = new Map<string, ClusterProbeState>();
    let concurrent = 0;
    let maxConcurrent = 0;
    await Promise.all([
      runProbeTick({
        listClusters: async () => [cluster('a')],
        probeOne: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
          return okProbe('a');
        },
        state,
      }),
      runProbeTick({
        listClusters: async () => [cluster('a')],
        probeOne: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
          return okProbe('a');
        },
        state,
      }),
    ]);
    assert.equal(maxConcurrent, 1);
  });
});

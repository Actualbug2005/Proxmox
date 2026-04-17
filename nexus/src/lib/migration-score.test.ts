import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { scoreTargets, type GuestResourceAsk, type NodeSnapshot } from './migration-score';

const GB = 1024 ** 3;

const ask: GuestResourceAsk = {
  vmid: 100,
  cores: 2,
  memoryBytes: 2 * GB,
  sourceNode: 'pve1',
};

function mk(partial: Partial<NodeSnapshot> & { name: string }): NodeSnapshot {
  return {
    online: true,
    maxCores: 8,
    cpu: 0,
    maxMemory: 32 * GB,
    memory: 0,
    ...partial,
  };
}

describe('scoreTargets', () => {
  it('disqualifies the source node', () => {
    const out = scoreTargets(
      ask,
      [mk({ name: 'pve1' }), mk({ name: 'pve2' })],
      undefined,
      new Map(),
    );
    const src = out.find((o) => o.node === 'pve1')!;
    assert.equal(src.disqualified, true);
    assert.ok(src.reasons.includes('source node'));
  });

  it('disqualifies offline nodes', () => {
    const out = scoreTargets(
      ask,
      [mk({ name: 'pve2', online: false }), mk({ name: 'pve3' })],
      undefined,
      new Map(),
    );
    const off = out.find((o) => o.node === 'pve2')!;
    assert.equal(off.disqualified, true);
    assert.ok(off.reasons.includes('node offline'));
  });

  it('propagates precondition reasons verbatim', () => {
    const out = scoreTargets(
      ask,
      [mk({ name: 'pve2' })],
      undefined,
      new Map([['pve2', 'storage "local-lvm" not available on target']]),
    );
    const row = out[0];
    assert.equal(row.disqualified, true);
    assert.ok(row.reasons.includes('storage "local-lvm" not available on target'));
  });

  it('applies allowed_nodes as a whitelist when present', () => {
    const out = scoreTargets(
      ask,
      [mk({ name: 'pve2' }), mk({ name: 'pve3' })],
      new Set(['pve2']),
      new Map(),
    );
    const pve3 = out.find((o) => o.node === 'pve3')!;
    assert.equal(pve3.disqualified, true);
    assert.ok(pve3.reasons[0]?.includes('precondition'));
  });

  it('higher pressure → lower score', () => {
    const out = scoreTargets(
      ask,
      [
        mk({ name: 'loaded', cpu: 0.8, memory: 20 * GB }),
        mk({ name: 'idle', cpu: 0.1, memory: 2 * GB }),
      ],
      undefined,
      new Map(),
    );
    const loaded = out.find((o) => o.node === 'loaded')!;
    const idle = out.find((o) => o.node === 'idle')!;
    assert.ok(idle.score > loaded.score, `idle (${idle.score}) should outscore loaded (${loaded.score})`);
  });

  it('top non-disqualified gets the recommended label', () => {
    const out = scoreTargets(
      ask,
      [
        mk({ name: 'loaded', cpu: 0.7, memory: 25 * GB }),
        mk({ name: 'idle', cpu: 0.1, memory: 1 * GB }),
        mk({ name: 'pve1' }), // source — disqualified
      ],
      undefined,
      new Map(),
    );
    assert.equal(out[0].node, 'idle');
    assert.equal(out[0].label, 'recommended');
    assert.notEqual(out[1].label, 'recommended');
  });

  it('CPU headroom below 10% after placement → disqualified', () => {
    // 8-core node at 95% CPU → headroom after placing 2 cores is (1 - 0.95 - 0.25) < 0
    const out = scoreTargets(
      ask,
      [mk({ name: 'packed', maxCores: 8, cpu: 0.95 })],
      undefined,
      new Map(),
    );
    assert.equal(out[0].disqualified, true);
    assert.ok(out[0].reasons.some((r) => r.includes('CPU headroom')));
  });

  it('memory headroom below 10% → disqualified', () => {
    // 32 GB node with 29 GB used + 2 GB ask → 1 GB free ≈ 3% headroom
    const out = scoreTargets(
      ask,
      [mk({ name: 'full', maxMemory: 32 * GB, memory: 29 * GB })],
      undefined,
      new Map(),
    );
    assert.equal(out[0].disqualified, true);
    assert.ok(out[0].reasons.some((r) => r.includes('memory headroom')));
  });

  it('missing loadavg1 is acceptable and yields no penalty', () => {
    const out = scoreTargets(
      ask,
      [
        mk({ name: 'a', cpu: 0.1, memory: 1 * GB, loadavg1: undefined }),
        mk({ name: 'b', cpu: 0.1, memory: 1 * GB, loadavg1: 0 }),
      ],
      undefined,
      new Map(),
    );
    const a = out.find((o) => o.node === 'a')!;
    const b = out.find((o) => o.node === 'b')!;
    assert.equal(a.score, b.score);
  });

  it('disqualified rows sort to the end even with higher nominal score', () => {
    const out = scoreTargets(
      ask,
      [
        mk({ name: 'pve1' }), // disqualified (source)
        mk({ name: 'pve2', cpu: 0.6, memory: 20 * GB }),
      ],
      undefined,
      new Map(),
    );
    assert.equal(out[0].node, 'pve2');
    assert.equal(out[1].node, 'pve1');
  });

  it('loadavg above core count caps the loadavg penalty', () => {
    // loadavg1 way above maxCores should saturate at 20 points off, not blow up.
    const out = scoreTargets(
      ask,
      [mk({ name: 'overloaded', cpu: 0.1, memory: 1 * GB, loadavg1: 100 })],
      undefined,
      new Map(),
    );
    assert.ok(out[0].score >= 40, `score should be ≥ 40 (started at 100, max penalty 60), got ${out[0].score}`);
  });
});

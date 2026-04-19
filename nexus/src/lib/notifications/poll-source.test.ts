/**
 * Unit tests for the metric polling source.
 *
 * `computeMetrics` is pure — given cluster state, yield readings. The
 * tests focus on that path (dropped-offline nodes, scope shape, the
 * five metric names being emitted in the expected form) so a future
 * change to the metrics set is a visible test delta.
 *
 * The full tick integration (rules → emit → backoff) is exercised
 * indirectly via dispatcher.test.ts; the goal here is to pin the
 * scope/name contract operators will bind rules against.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { METRIC_NAMES, computeMetrics } from './poll-source.ts';
import type { ClusterResourcePublic, NodeStatus } from '../../types/proxmox.ts';

function node(name: string, over: Partial<ClusterResourcePublic> = {}): ClusterResourcePublic {
  return {
    id: `node/${name}`,
    type: 'node',
    node: name,
    status: 'online',
    cpu: 0.1,
    mem: 100,
    maxmem: 1000,
    maxcpu: 8,
    ...over,
  } as ClusterResourcePublic;
}

function guest(vmid: number, status: string, nodeName = 'pve'): ClusterResourcePublic {
  return { id: `qemu/${vmid}`, type: 'qemu', node: nodeName, vmid, status } as ClusterResourcePublic;
}

function status(loadavg1: string): NodeStatus {
  return { loadavg: [loadavg1, '0', '0'] } as NodeStatus;
}

describe('computeMetrics', () => {
  it('emits cluster-wide CPU + mem averages as single "cluster"-scoped rows', () => {
    const out = computeMetrics(
      [node('a', { cpu: 0.5, mem: 500, maxmem: 1000 }), node('b', { cpu: 0.9, mem: 100, maxmem: 1000 })],
      {},
    );
    const cpu = out.find((r) => r.metric === 'cluster.cpu.avg');
    const mem = out.find((r) => r.metric === 'cluster.mem.avg');
    assert.ok(cpu && cpu.scope === 'cluster');
    assert.ok(Math.abs(cpu.value - 0.7) < 1e-9);
    assert.ok(mem && mem.scope === 'cluster');
    assert.ok(Math.abs(mem.value - 0.3) < 1e-9);
  });

  it('skips offline nodes when averaging', () => {
    const out = computeMetrics(
      [
        node('a', { cpu: 1.0, status: 'online' }),
        node('b', { cpu: 0.0, status: 'offline' }),
      ],
      {},
    );
    const cpu = out.find((r) => r.metric === 'cluster.cpu.avg');
    assert.equal(cpu?.value, 1.0, 'offline node must not drag the average down');
  });

  it('emits per-node CPU + loadavg with node:<name> scope', () => {
    const out = computeMetrics(
      [node('pve-01', { cpu: 0.42, maxcpu: 4 })],
      { 'pve-01': status('2.0') },
    );
    const nodeCpu = out.find(
      (r) => r.metric === 'node.cpu.max' && r.scope === 'node:pve-01',
    );
    const nodeLoad = out.find(
      (r) => r.metric === 'node.loadavg.per_core' && r.scope === 'node:pve-01',
    );
    assert.equal(nodeCpu?.value, 0.42);
    // load / cores = 2.0 / 4 = 0.5
    assert.equal(nodeLoad?.value, 0.5);
  });

  it('counts guests in non-running non-stopped states as "failing"', () => {
    const out = computeMetrics(
      [
        node('pve'),
        guest(100, 'running'),
        guest(101, 'stopped'),
        guest(102, 'error'),
        guest(103, 'paused'),
      ],
      {},
    );
    const failing = out.find((r) => r.metric === 'guests.failing.count');
    assert.equal(failing?.value, 2, 'error + paused count as failing; running + stopped do not');
    assert.equal(failing?.scope, 'cluster');
  });

  it('exposes the canonical v1 metric names', () => {
    assert.deepEqual([...METRIC_NAMES], [
      'cluster.cpu.avg',
      'cluster.mem.avg',
      'node.cpu.max',
      'node.loadavg.per_core',
      'guest.cpu',
      'guest.mem',
      'guests.failing.count',
    ]);
  });
});

describe('computeMetrics — per-guest metrics', () => {
  it('emits guest.cpu for each running guest with a cpu value', () => {
    const readings = computeMetrics(
      [
        node('pve-01', { cpu: 0.3, maxcpu: 4 }),
        { id: 'qemu/100', type: 'qemu', node: 'pve-01', vmid: 100, status: 'running', cpu: 0.9, mem: 0, maxmem: 0 } as ClusterResourcePublic,
        { id: 'qemu/101', type: 'qemu', node: 'pve-01', vmid: 101, status: 'stopped', cpu: 0, mem: 0, maxmem: 0 } as ClusterResourcePublic,
      ],
      {},
    );
    const cpuReadings = readings.filter((r) => r.metric === 'guest.cpu');
    assert.equal(cpuReadings.length, 1);
    assert.equal(cpuReadings[0].scope, 'guest:100');
    assert.equal(cpuReadings[0].value, 0.9);
  });

  it('emits guest.mem as a fraction for each running guest with mem/maxmem > 0', () => {
    const readings = computeMetrics(
      [
        node('pve-01', { cpu: 0.3, maxcpu: 4 }),
        {
          id: 'qemu/100', type: 'qemu', node: 'pve-01', vmid: 100, status: 'running',
          cpu: 0.1, mem: 512 * 1024 * 1024, maxmem: 1024 * 1024 * 1024,
        } as ClusterResourcePublic,
      ],
      {},
    );
    const memReadings = readings.filter((r) => r.metric === 'guest.mem');
    assert.equal(memReadings.length, 1);
    assert.equal(memReadings[0].scope, 'guest:100');
    assert.equal(memReadings[0].value, 0.5);
  });

  it('skips guests missing cpu/mem or maxmem=0', () => {
    const readings = computeMetrics(
      [
        { id: 'qemu/100', type: 'qemu', node: 'pve-01', vmid: 100, status: 'running', cpu: undefined, mem: 0, maxmem: 0 } as unknown as ClusterResourcePublic,
        { id: 'qemu/101', type: 'qemu', node: 'pve-01', vmid: 101, status: 'running', cpu: 0.5, mem: 100, maxmem: 0 } as ClusterResourcePublic,
      ],
      {},
    );
    // vmid 101 has cpu; vmid 100 doesn't.
    assert.equal(readings.filter((r) => r.metric === 'guest.cpu').length, 1);
    // Neither has maxmem > 0.
    assert.equal(readings.filter((r) => r.metric === 'guest.mem').length, 0);
  });
});

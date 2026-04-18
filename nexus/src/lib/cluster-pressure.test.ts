import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { computePressure } from './cluster-pressure';
import type { ClusterResourcePublic, NodeStatus, PVETask } from '@/types/proxmox';

function node(name: string, cpu = 0, mem = 0, maxmem = 0, online = true): ClusterResourcePublic {
  return {
    id: `node/${name}`,
    type: 'node',
    node: name,
    name,
    status: online ? 'online' : 'offline',
    cpu,
    mem,
    maxmem,
    maxcpu: 8,
  } as ClusterResourcePublic;
}

function vm(vmid: number, node_: string, cpu = 0, mem = 0, maxmem = 0, status = 'running'): ClusterResourcePublic {
  return {
    id: `qemu/${vmid}`,
    type: 'qemu',
    vmid,
    node: node_,
    name: `vm${vmid}`,
    status,
    cpu,
    mem,
    maxmem,
  } as ClusterResourcePublic;
}

function ct(vmid: number, node_: string, cpu = 0, mem = 0, maxmem = 0, status = 'running'): ClusterResourcePublic {
  return {
    id: `lxc/${vmid}`,
    type: 'lxc',
    vmid,
    node: node_,
    name: `ct${vmid}`,
    status,
    cpu,
    mem,
    maxmem,
  } as ClusterResourcePublic;
}

function task(upid: string, exitstatus: string | undefined, starttime: number): PVETask {
  // exitstatus undefined === task is still running (no endtime either).
  // Any string value means the task is terminal.
  if (exitstatus === undefined) {
    return { upid, node: 'pve', type: 'test', user: 'u@pam', starttime };
  }
  return { upid, node: 'pve', type: 'test', user: 'u@pam', starttime,
    endtime: starttime + 1, exitstatus };
}

const nodeStatus = (load1: number): NodeStatus =>
  ({
    node: 'pve',
    status: 'online',
    cpu: 0,
    cpuinfo: { cpus: 8, cores: 8, sockets: 1, mhz: '', model: '' },
    memory: { total: 0, used: 0, free: 0 },
    swap: { total: 0, used: 0, free: 0 },
    rootfs: { total: 0, used: 0, free: 0, avail: 0 },
    uptime: 0,
    loadavg: [String(load1), '0', '0'],
  }) as unknown as NodeStatus;

describe('computePressure', () => {
  it('counts nodes + guests and averages pressure', () => {
    const out = computePressure(
      [
        node('pve1', 0.5, 8 * 1024 ** 3, 16 * 1024 ** 3),
        node('pve2', 0.1, 4 * 1024 ** 3, 32 * 1024 ** 3),
        vm(100, 'pve1', 0.3, 2 * 1024 ** 3, 4 * 1024 ** 3),
        ct(200, 'pve1', 0.05, 256 * 1024 ** 2, 512 * 1024 ** 2),
      ],
      {},
      [],
    );
    assert.equal(out.nodesOnline, 2);
    assert.equal(out.nodesTotal, 2);
    assert.equal(out.runningGuests, 2);
    assert.ok(Math.abs(out.avgCpu - 0.3) < 0.01);
    assert.ok(out.avgMemory > 0);
  });

  it('excludes offline nodes from averages', () => {
    const out = computePressure(
      [
        node('pve1', 0.8, 0, 0),
        node('pve2', 0.0, 0, 0, false),
      ],
      {},
      [],
    );
    assert.equal(out.nodesOnline, 1);
    assert.equal(out.nodesTotal, 2);
    assert.equal(out.avgCpu, 0.8);
  });

  it('excludes stopped guests from top-N rankings', () => {
    const out = computePressure(
      [
        node('pve1'),
        vm(100, 'pve1', 0.9, 0, 0, 'running'),
        vm(101, 'pve1', 0.95, 0, 0, 'stopped'),
      ],
      {},
      [],
    );
    assert.equal(out.topGuestsByCpu.length, 1);
    assert.equal(out.topGuestsByCpu[0].vmid, 100);
  });

  it('ranks top-N by CPU descending', () => {
    const out = computePressure(
      [
        node('pve1'),
        vm(100, 'pve1', 0.5),
        vm(101, 'pve1', 0.9),
        vm(102, 'pve1', 0.1),
      ],
      {},
      [],
      2,
    );
    assert.equal(out.topGuestsByCpu.length, 2);
    assert.equal(out.topGuestsByCpu[0].vmid, 101);
    assert.equal(out.topGuestsByCpu[1].vmid, 100);
  });

  it('computes peak loadavg per core from node status', () => {
    const out = computePressure(
      [node('pve1'), node('pve2')],
      { pve1: nodeStatus(1.0), pve2: nodeStatus(8.0) }, // maxcpu=8 each
      [],
    );
    assert.ok(out.peakLoadavgPerCore !== undefined);
    assert.equal(out.peakLoadavgPerCore, 1.0); // 8/8
  });

  it('collects recent failures newest-first, capped at 10', () => {
    const tasks: PVETask[] = [
      task('ok', 'OK', 100),
      task('fail1', 'got signal 9', 300),
      task('fail2', 'timeout', 200),
      task('running', undefined, 400),
    ];
    const out = computePressure([node('pve1')], {}, tasks);
    assert.equal(out.recentFailures.length, 2);
    assert.equal(out.recentFailures[0].upid, 'fail1');
    assert.equal(out.recentFailures[1].upid, 'fail2');
  });

  it('tolerates empty inputs', () => {
    const out = computePressure([], {}, []);
    assert.equal(out.nodesOnline, 0);
    assert.equal(out.avgCpu, 0);
    assert.equal(out.avgMemory, 0);
    assert.equal(out.topGuestsByCpu.length, 0);
    assert.equal(out.recentFailures.length, 0);
    assert.equal(out.peakLoadavgPerCore, undefined);
  });
});

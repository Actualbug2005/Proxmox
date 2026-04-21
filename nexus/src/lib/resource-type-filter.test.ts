import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { filterByType, TYPE_IDS, type TypeFilter } from './resource-type-filter';
import type { ClusterResourcePublic } from '@/types/proxmox';

const sample: ClusterResourcePublic[] = [
  { id: 'node/pve1',   type: 'node',    status: 'online' } as ClusterResourcePublic,
  { id: 'qemu/100',    type: 'qemu',    status: 'running', node: 'pve1', vmid: 100 } as ClusterResourcePublic,
  { id: 'lxc/200',     type: 'lxc',     status: 'running', node: 'pve1', vmid: 200 } as ClusterResourcePublic,
  { id: 'storage/a',   type: 'storage', status: 'available', node: 'pve1' } as ClusterResourcePublic,
];

describe('filterByType', () => {
  it('returns everything for "all"', () => {
    assert.equal(filterByType(sample, 'all').length, 4);
  });
  it('returns only nodes for "nodes"', () => {
    const r = filterByType(sample, 'nodes');
    assert.deepEqual(r.map((x) => x.type), ['node']);
  });
  it('returns only qemu for "vms"', () => {
    assert.deepEqual(filterByType(sample, 'vms').map((x) => x.type), ['qemu']);
  });
  it('returns only lxc for "cts"', () => {
    assert.deepEqual(filterByType(sample, 'cts').map((x) => x.type), ['lxc']);
  });
  it('TYPE_IDS is frozen in the expected order', () => {
    assert.deepEqual([...TYPE_IDS], ['all', 'nodes', 'vms', 'cts']);
  });
  it('compiles as a TypeFilter literal', () => {
    const _test: TypeFilter = 'all';
    void _test;
  });
});

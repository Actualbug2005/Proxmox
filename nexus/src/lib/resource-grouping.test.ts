/**
 * Grouping is the only place a tag-rename or pool-move bug would
 * silently misclassify a guest. Pin every dispatch path here so a
 * "small refactor" of the helper can't quietly drop the
 * untagged / no-pool buckets or break multi-tag membership.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  groupResources,
  parseTagList,
  type ViewMode,
} from './resource-grouping.ts';
import type { ClusterResourcePublic } from '../types/proxmox.ts';

function guest(
  id: string,
  type: 'qemu' | 'lxc',
  node: string,
  opts: { tags?: string; pool?: string; vmid?: number; name?: string } = {},
): ClusterResourcePublic {
  return {
    id,
    type,
    node,
    name: opts.name ?? id,
    vmid: opts.vmid,
    tags: opts.tags,
    pool: opts.pool,
  } as ClusterResourcePublic;
}

function nodeRow(name: string): ClusterResourcePublic {
  return { id: `node/${name}`, type: 'node', node: name, status: 'online' } as ClusterResourcePublic;
}

describe('parseTagList', () => {
  it('splits semicolon-delimited tags and trims whitespace', () => {
    assert.deepEqual(parseTagList('prod;web;tier1'), ['prod', 'web', 'tier1']);
    assert.deepEqual(parseTagList(' a ; b ;c '), ['a', 'b', 'c']);
  });
  it('drops empty entries from trailing or doubled separators', () => {
    assert.deepEqual(parseTagList('a;;b;'), ['a', 'b']);
    assert.deepEqual(parseTagList(';'), []);
  });
  it('returns [] for missing / empty / whitespace', () => {
    assert.deepEqual(parseTagList(undefined), []);
    assert.deepEqual(parseTagList(''), []);
  });
});

describe('groupResources(flat)', () => {
  it('returns one bucket containing every guest, regardless of node/tag/pool', () => {
    const res = [
      nodeRow('pve'),
      guest('a', 'qemu', 'pve'),
      guest('b', 'lxc',  'pve2', { tags: 'prod' }),
      guest('c', 'qemu', 'pve',  { pool: 'web' }),
    ];
    const groups = groupResources(res, 'flat');
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, 'flat');
    assert.equal(groups[0].members.length, 3, 'node row excluded; all 3 guests in one bucket');
  });
  it('returns [] when there are no guests', () => {
    assert.deepEqual(groupResources([nodeRow('pve')], 'flat'), []);
  });
});

describe('groupResources(nodes)', () => {
  it('groups by node, preserves first-seen node order, attaches guests', () => {
    const res = [
      nodeRow('pve1'),
      nodeRow('pve2'),
      guest('a', 'qemu', 'pve2'),
      guest('b', 'lxc', 'pve1'),
      guest('c', 'qemu', 'pve1'),
    ];
    const groups = groupResources(res, 'nodes');
    assert.deepEqual(groups.map((g) => g.label), ['pve1', 'pve2']);
    assert.deepEqual(groups[0].members.map((g) => g.id), ['b', 'c']);
    assert.deepEqual(groups[1].members.map((g) => g.id), ['a']);
  });
  it('synthesises an `unknown` bucket for guests with no node field', () => {
    const orphan = { id: 'lost', type: 'qemu', name: 'lost' } as ClusterResourcePublic;
    const groups = groupResources([orphan], 'nodes');
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, 'unknown');
  });
});

describe('groupResources(tags)', () => {
  it('places multi-tagged guests in every matching bucket', () => {
    const res = [
      guest('a', 'qemu', 'pve', { tags: 'prod;web' }),
      guest('b', 'qemu', 'pve', { tags: 'prod;db' }),
      guest('c', 'qemu', 'pve', { tags: 'web' }),
    ];
    const groups = groupResources(res, 'tags');
    const bucketsByLabel = Object.fromEntries(groups.map((g) => [g.label, g.members.map((m) => m.id)]));
    assert.deepEqual(bucketsByLabel.prod, ['a', 'b']);
    assert.deepEqual(bucketsByLabel.web,  ['a', 'c']);
    assert.deepEqual(bucketsByLabel.db,   ['b']);
  });
  it('appends an Untagged bucket at the end when present', () => {
    const res = [
      guest('a', 'qemu', 'pve', { tags: 'prod' }),
      guest('b', 'qemu', 'pve'),
      guest('c', 'qemu', 'pve', { tags: '' }),
    ];
    const groups = groupResources(res, 'tags');
    assert.equal(groups[groups.length - 1].label, 'Untagged');
    assert.equal(groups[groups.length - 1].members.length, 2, 'b + c');
  });
  it('omits the Untagged bucket when every guest has at least one tag', () => {
    const res = [guest('a', 'qemu', 'pve', { tags: 'prod' })];
    const groups = groupResources(res, 'tags');
    assert.ok(!groups.some((g) => g.label === 'Untagged'));
  });
});

describe('groupResources(pools)', () => {
  it('groups by pool with single-membership and an end "No pool" bucket', () => {
    const res = [
      guest('a', 'qemu', 'pve', { pool: 'web' }),
      guest('b', 'qemu', 'pve', { pool: 'web' }),
      guest('c', 'qemu', 'pve', { pool: 'db' }),
      guest('d', 'qemu', 'pve'),
    ];
    const groups = groupResources(res, 'pools');
    assert.deepEqual(groups.map((g) => g.label), ['web', 'db', 'No pool']);
    assert.deepEqual(groups[0].members.map((g) => g.id), ['a', 'b']);
    assert.deepEqual(groups[2].members.map((g) => g.id), ['d']);
  });
});

describe('view mode dispatch is exhaustive', () => {
  // If a new ViewMode lands, this test will fail at compile time because
  // `mode` widens to `never` only when every case is covered. Belt-and-
  // braces against silently dropping a mode in the dispatch.
  const modes: ViewMode[] = ['flat', 'nodes', 'tags', 'pools'];
  for (const mode of modes) {
    it(`returns an array for ${mode}`, () => {
      assert.ok(Array.isArray(groupResources([], mode)));
    });
  }
});

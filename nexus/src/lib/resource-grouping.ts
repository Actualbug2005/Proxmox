/**
 * Pure grouping helpers for the cluster resource tree.
 *
 * The view mode is a presentation concern — Flat is one bucket, Nodes
 * mirrors PVE's own tree, Tags groups by the `tags` field (multi-membership
 * supported because a guest can have multiple tags), and Pools groups by
 * the `pool` field (single-membership, since a guest can only sit in one
 * PVE pool at a time).
 *
 * Pulled out of resource-tree.tsx so:
 *  - the rendering layer stays a thin map over the grouping output
 *  - the grouping logic is unit-testable without React
 *  - future modes (e.g. by storage backend) can land here without
 *    touching the tree component
 */
import type { ClusterResourcePublic } from '@/types/proxmox';

export type ViewMode = 'flat' | 'nodes' | 'tags' | 'pools';

/** A single group rendered in the tree. */
export interface ResourceGroup {
  /** Stable id used as React key + collapse-state key. */
  id: string;
  /** Human label rendered in the group header. */
  label: string;
  /**
   * Optional secondary label rendered after the count, e.g. the node row
   * for a Nodes-mode group. Tags / Pools modes leave this empty.
   */
  sublabel?: string;
  /** Resources that belong to this group (in their original order). */
  members: ClusterResourcePublic[];
}

/**
 * Split a PVE tag string into a clean list. PVE serialises tags as
 * "tag1;tag2;tag3"; trims whitespace and drops empty entries so a
 * trailing semicolon doesn't yield a phantom "" tag.
 */
export function parseTagList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const UNTAGGED_LABEL = 'Untagged';
const NO_POOL_LABEL = 'No pool';
const ORPHANED_NODE_LABEL = 'unknown';

/**
 * Filter the input down to guests (qemu + lxc) only. Nodes and storage
 * pools are infrastructure resources, not guests; the grouping views
 * are about "which guests live where", so we strip them out at the
 * boundary so each mode doesn't have to repeat the filter.
 */
function guestsOnly(
  resources: readonly ClusterResourcePublic[],
): ClusterResourcePublic[] {
  return resources.filter((r) => r.type === 'qemu' || r.type === 'lxc');
}

function groupFlat(resources: readonly ClusterResourcePublic[]): ResourceGroup[] {
  const guests = guestsOnly(resources);
  if (guests.length === 0) return [];
  return [
    {
      id: 'flat',
      label: 'All guests',
      sublabel: `${guests.length} total`,
      members: guests,
    },
  ];
}

function groupByNode(resources: readonly ClusterResourcePublic[]): ResourceGroup[] {
  // Preserve PVE's own per-node order: the API returns nodes in cluster
  // order, so we walk the input once and let the first-seen node row
  // anchor each bucket.
  const buckets = new Map<string, { node?: ClusterResourcePublic; guests: ClusterResourcePublic[] }>();
  for (const r of resources) {
    if (r.type === 'node') {
      const name = r.node ?? r.id;
      if (!buckets.has(name)) buckets.set(name, { guests: [] });
      buckets.get(name)!.node = r;
    } else if (r.type === 'qemu' || r.type === 'lxc') {
      const name = r.node ?? ORPHANED_NODE_LABEL;
      if (!buckets.has(name)) buckets.set(name, { guests: [] });
      buckets.get(name)!.guests.push(r);
    }
  }
  const out: ResourceGroup[] = [];
  for (const [name, b] of buckets) {
    out.push({
      id: `node:${name}`,
      label: name,
      sublabel: `${b.guests.length} guests`,
      members: b.guests,
    });
  }
  return out;
}

function groupByTag(resources: readonly ClusterResourcePublic[]): ResourceGroup[] {
  const guests = guestsOnly(resources);
  // Map keeps insertion order so tag groups appear in first-seen order.
  // Untagged is appended at the end if present, so the operator's eye
  // hits real tags first.
  const buckets = new Map<string, ClusterResourcePublic[]>();
  const untagged: ClusterResourcePublic[] = [];
  for (const g of guests) {
    const tags = parseTagList(g.tags);
    if (tags.length === 0) {
      untagged.push(g);
      continue;
    }
    for (const tag of tags) {
      if (!buckets.has(tag)) buckets.set(tag, []);
      buckets.get(tag)!.push(g);
    }
  }
  const out: ResourceGroup[] = [];
  for (const [tag, members] of buckets) {
    out.push({
      id: `tag:${tag}`,
      label: tag,
      sublabel: `${members.length} guests`,
      members,
    });
  }
  if (untagged.length > 0) {
    out.push({
      id: 'tag:__untagged__',
      label: UNTAGGED_LABEL,
      sublabel: `${untagged.length} guests`,
      members: untagged,
    });
  }
  return out;
}

function groupByPool(resources: readonly ClusterResourcePublic[]): ResourceGroup[] {
  const guests = guestsOnly(resources);
  const buckets = new Map<string, ClusterResourcePublic[]>();
  const noPool: ClusterResourcePublic[] = [];
  for (const g of guests) {
    const pool = g.pool?.trim();
    if (!pool) {
      noPool.push(g);
      continue;
    }
    if (!buckets.has(pool)) buckets.set(pool, []);
    buckets.get(pool)!.push(g);
  }
  const out: ResourceGroup[] = [];
  for (const [pool, members] of buckets) {
    out.push({
      id: `pool:${pool}`,
      label: pool,
      sublabel: `${members.length} guests`,
      members,
    });
  }
  if (noPool.length > 0) {
    out.push({
      id: 'pool:__none__',
      label: NO_POOL_LABEL,
      sublabel: `${noPool.length} guests`,
      members: noPool,
    });
  }
  return out;
}

/**
 * Single dispatch entry for the tree component. Keeps the per-mode
 * helpers private to this module so callers can't accidentally bypass
 * the dispatch (which would silently drop the next mode added here).
 */
export function groupResources(
  resources: readonly ClusterResourcePublic[],
  mode: ViewMode,
): ResourceGroup[] {
  switch (mode) {
    case 'flat':
      return groupFlat(resources);
    case 'nodes':
      return groupByNode(resources);
    case 'tags':
      return groupByTag(resources);
    case 'pools':
      return groupByPool(resources);
  }
}

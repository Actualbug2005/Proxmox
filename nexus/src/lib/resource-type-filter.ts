import type { ClusterResourcePublic } from '@/types/proxmox';

export const TYPE_IDS = ['all', 'nodes', 'vms', 'cts'] as const;
export type TypeFilter = (typeof TYPE_IDS)[number];

export function filterByType(
  resources: readonly ClusterResourcePublic[],
  filter: TypeFilter,
): ClusterResourcePublic[] {
  if (filter === 'all') return [...resources];
  if (filter === 'nodes') return resources.filter((r) => r.type === 'node');
  if (filter === 'vms') return resources.filter((r) => r.type === 'qemu');
  if (filter === 'cts') return resources.filter((r) => r.type === 'lxc');
  const _exhaustive: never = filter;
  return _exhaustive;
}

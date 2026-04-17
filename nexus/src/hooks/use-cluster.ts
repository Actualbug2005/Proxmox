import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import type { ClusterResourcePublic } from '@/types/proxmox';

export function useClusterStatus() {
  return useQuery({
    queryKey: ['cluster', 'status'],
    queryFn: () => api.cluster.status(),
    refetchInterval: POLL_INTERVALS.cluster,
  });
}

/**
 * The "main" node — i.e. the cluster member currently serving Nexus.
 * `/cluster/status` flags exactly one node row with `local: true`; that's
 * the one Nexus's PVE proxy talks to. Falls back to the first online node
 * (then the first node) if /cluster/status hasn't loaded yet, so this is
 * always safe to use as a select-default seed.
 */
export function useDefaultNode(): string | null {
  const { data: status } = useClusterStatus();
  const { data: nodes } = useNodes();

  return useMemo(() => {
    const local = status?.find((row) => row.type === 'node' && row.local);
    if (local?.name) return local.name;

    const firstOnline = nodes.find((n) => n.status === 'online');
    if (firstOnline) return firstOnline.node ?? firstOnline.id;

    return nodes[0]?.node ?? nodes[0]?.id ?? null;
  }, [status, nodes]);
}

/**
 * Single source of truth for polling intervals. Keep these in milliseconds
 * and tune here rather than scattered across hooks/components.
 */
export const POLL_INTERVALS = {
  cluster: 10_000,
  nodeStatus: 10_000,
  tasks: 15_000,
  rrd: 30_000,
} as const;

export function useClusterResources() {
  return useQuery({
    queryKey: ['cluster', 'resources'],
    queryFn: () => api.cluster.resources(),
    refetchInterval: POLL_INTERVALS.cluster,
  });
}

export function useNodes() {
  const { data: resources, ...rest } = useClusterResources();
  const nodes = useMemo(
    () =>
      (resources ?? []).filter(
        (r): r is ClusterResourcePublic & { type: 'node' } => r.type === 'node',
      ),
    [resources],
  );
  return { data: nodes, ...rest };
}

export function useNodeVMs(nodeName: string) {
  const { data: resources } = useClusterResources();
  return useMemo(
    () => (resources ?? []).filter((r) => r.type === 'qemu' && r.node === nodeName),
    [resources, nodeName],
  );
}

export function useNodeCTs(nodeName: string) {
  const { data: resources } = useClusterResources();
  return useMemo(
    () => (resources ?? []).filter((r) => r.type === 'lxc' && r.node === nodeName),
    [resources, nodeName],
  );
}

export function useNodeRRD(node: string, timeframe: 'hour' | 'day' | 'week' = 'hour') {
  return useQuery({
    queryKey: ['node', node, 'rrd', timeframe],
    queryFn: () => api.nodes.rrd(node, timeframe),
    refetchInterval: POLL_INTERVALS.rrd,
  });
}

export function useNodeStatus(node: string) {
  return useQuery({
    queryKey: ['node', node, 'status'],
    queryFn: () => api.nodes.status(node),
    refetchInterval: POLL_INTERVALS.nodeStatus,
  });
}

export function useClusterTasks() {
  return useQuery({
    queryKey: ['cluster', 'tasks'],
    queryFn: () => api.cluster.tasks(),
    refetchInterval: POLL_INTERVALS.tasks,
  });
}

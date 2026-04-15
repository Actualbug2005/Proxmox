import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import type { ClusterResourcePublic } from '@/types/proxmox';

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

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import type { ClusterResource } from '@/types/proxmox';

export function useClusterResources() {
  return useQuery({
    queryKey: ['cluster', 'resources'],
    queryFn: () => api.cluster.resources(),
    refetchInterval: 10_000,
  });
}

export function useNodes() {
  const { data: resources, ...rest } = useClusterResources();
  const nodes = resources?.filter((r): r is ClusterResource & { type: 'node' } => r.type === 'node') ?? [];
  return { data: nodes, ...rest };
}

export function useNodeVMs(nodeName: string) {
  const { data: resources } = useClusterResources();
  return (
    resources?.filter((r) => r.type === 'qemu' && r.node === nodeName) ?? []
  );
}

export function useNodeCTs(nodeName: string) {
  const { data: resources } = useClusterResources();
  return (
    resources?.filter((r) => r.type === 'lxc' && r.node === nodeName) ?? []
  );
}

export function useNodeRRD(node: string, timeframe: 'hour' | 'day' | 'week' = 'hour') {
  return useQuery({
    queryKey: ['node', node, 'rrd', timeframe],
    queryFn: () => api.nodes.rrd(node, timeframe),
    refetchInterval: 30_000,
  });
}

export function useNodeStatus(node: string) {
  return useQuery({
    queryKey: ['node', node, 'status'],
    queryFn: () => api.nodes.status(node),
    refetchInterval: 10_000,
  });
}

export function useClusterTasks() {
  return useQuery({
    queryKey: ['cluster', 'tasks'],
    queryFn: () => api.cluster.tasks(),
    refetchInterval: 15_000,
  });
}

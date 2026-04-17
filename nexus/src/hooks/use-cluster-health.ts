/**
 * Composed hook for the NOC view.
 *
 * Combines:
 *   - cluster.resources (current cpu/mem/status per node + guest, 10s poll)
 *   - per-node status (loadavg parsed from NodeStatus.loadavg tuple, 10s)
 *   - per-storage RRD (week-timeframe, 5-min poll) → daysUntilFull
 *   - cluster.tasks (15s poll) → recentFailures
 *
 * Passes the assembled inputs to the pure computePressure() for
 * ranking + averaging. Storage is computed separately since it needs
 * RRD rather than the current snapshot.
 */

import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useClusterResources, useClusterTasks } from '@/hooks/use-cluster';
import { computePressure, type ClusterPressure } from '@/lib/cluster-pressure';
import { daysUntilFull } from '@/lib/trend';
import type {
  ClusterResourcePublic,
  NodeStatus,
  PVEStoragePublic,
} from '@/types/proxmox';

const STORAGE_RRD_STALE_MS = 5 * 60 * 1000; // 5 minutes — RRD updates every ~2.4 h anyway

export interface StorageHealthRow {
  storage: string;
  node: string;
  used: number;
  total: number;
  usedFraction: number;
  /** Null when the series is flat/falling or has too few points. */
  daysUntilFull: number | null;
}

export interface ClusterHealthResult {
  pressure: ClusterPressure | null;
  storage: StorageHealthRow[];
  loading: boolean;
  error: Error | null;
}

export function useClusterHealth(): ClusterHealthResult {
  const { data: resources, isLoading: resLoading, error: resError } = useClusterResources();
  const { data: tasks } = useClusterTasks();

  const onlineNodes = useMemo(
    () =>
      (resources ?? []).filter(
        (r): r is ClusterResourcePublic & { type: 'node' } =>
          r.type === 'node' && r.status === 'online',
      ),
    [resources],
  );

  // Parallel per-node status fetches for loadavg. useQueries key each by
  // the node name so toggling online/offline doesn't refire existing ones.
  const statusQueries = useQueries({
    queries: onlineNodes.map((n) => ({
      queryKey: ['node', n.node ?? n.id, 'status'],
      queryFn: () => api.nodes.status(n.node ?? n.id),
      staleTime: 5_000,
    })),
  });

  const statusMap = useMemo(() => {
    const m: Record<string, NodeStatus | undefined> = {};
    onlineNodes.forEach((n, i) => {
      m[n.node ?? n.id] = statusQueries[i]?.data as NodeStatus | undefined;
    });
    return m;
  }, [onlineNodes, statusQueries]);

  // Storage list per online node. We fetch from the first online node
  // (PVE replicates the storage config across the cluster, so any node
  // gives us the same catalog); we then fetch RRD per unique
  // (node, storage) pair to get historical series. Keeping it to the
  // originating node keeps the request count bounded.
  const primaryNode = onlineNodes[0]?.node ?? onlineNodes[0]?.id ?? null;
  const { data: storageList } = useQuery<PVEStoragePublic[], Error>({
    queryKey: ['storage', 'list', primaryNode],
    enabled: !!primaryNode,
    queryFn: () => api.storage.list(primaryNode!),
    staleTime: 30_000,
  });

  const storageRows = useMemo(
    () =>
      (storageList ?? [])
        .filter((s) => s.active !== false && s.total !== undefined && s.total > 0)
        .map((s) => ({
          storage: s.storage,
          node: primaryNode ?? '',
          used: s.used ?? 0,
          total: s.total ?? 0,
        })),
    [storageList, primaryNode],
  );

  const storageRrdQueries = useQueries({
    queries: storageRows.map((row) => ({
      queryKey: ['storage', 'rrd', row.node, row.storage, 'week'],
      queryFn: () => api.storage.rrd(row.node, row.storage, 'week'),
      staleTime: STORAGE_RRD_STALE_MS,
      refetchInterval: STORAGE_RRD_STALE_MS,
    })),
  });

  const storageHealth = useMemo<StorageHealthRow[]>(() => {
    return storageRows.map((row, i) => {
      const rrd = storageRrdQueries[i]?.data ?? [];
      const projected = daysUntilFull(rrd, 0.95);
      return {
        ...row,
        usedFraction: row.total > 0 ? row.used / row.total : 0,
        daysUntilFull: projected,
      };
    });
  }, [storageRows, storageRrdQueries]);

  const pressure = useMemo<ClusterPressure | null>(() => {
    if (!resources) return null;
    return computePressure(resources, statusMap, tasks ?? []);
  }, [resources, statusMap, tasks]);

  return {
    pressure,
    storage: storageHealth,
    loading: resLoading,
    error: (resError as Error | null) ?? null,
  };
}

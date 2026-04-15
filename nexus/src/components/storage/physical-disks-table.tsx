'use client';

/**
 * Physical Disks listing across one or more nodes.
 * Fetches GET /nodes/{node}/disks/list per selected node and renders one
 * row per device. Click → SmartDetails modal.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNodes } from '@/hooks/use-cluster';
import { api } from '@/lib/proxmox-client';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/lib/utils';
import { Loader2, HardDrive } from 'lucide-react';
import type { DiskListEntry, SmartHealth } from '@/types/proxmox';
import { SmartDetails } from './smart-details';

interface DiskRow extends DiskListEntry {
  node: string;
}

const HEALTH_VARIANT: Record<SmartHealth, 'success' | 'danger' | 'warning'> = {
  PASSED: 'success',
  FAILED: 'danger',
  UNKNOWN: 'warning',
};

function diskTypeBadge(type: DiskListEntry['type']): 'info' | 'outline' {
  if (type === 'nvme' || type === 'ssd') return 'info';
  return 'outline';
}

export function PhysicalDisksTable() {
  const { data: nodes, isLoading: nodesLoading } = useNodes();
  const nodeNames = useMemo(() => nodes?.map((n) => n.node ?? n.id) ?? [], [nodes]);

  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [selected, setSelected] = useState<DiskRow | null>(null);

  const visibleNodes = useMemo(
    () => (nodeFilter === 'all' ? nodeNames : [nodeFilter]),
    [nodeFilter, nodeNames],
  );

  const { data: disks, isLoading: disksLoading, error } = useQuery({
    queryKey: ['disks', visibleNodes],
    queryFn: async (): Promise<DiskRow[]> => {
      const results = await Promise.all(
        visibleNodes.map(async (node) => {
          const entries = await api.disks.list(node);
          return entries.map((d) => ({ ...d, node }));
        }),
      );
      return results.flat();
    },
    enabled: visibleNodes.length > 0,
    // Disk listings change on hardware add/remove — slow polling is fine.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const sorted = useMemo<DiskRow[]>(
    () =>
      [...(disks ?? [])].sort((a, b) => {
        if (a.node !== b.node) return a.node.localeCompare(b.node);
        return a.devpath.localeCompare(b.devpath);
      }),
    [disks],
  );

  const isLoading = nodesLoading || disksLoading;

  return (
    <>
      {selected && (
        <SmartDetails
          node={selected.node}
          disk={{ devpath: selected.devpath, model: selected.model, type: selected.type }}
          onClose={() => setSelected(null)}
        />
      )}

      {nodeNames.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {['all', ...nodeNames].map((n) => (
            <button
              key={n}
              onClick={() => setNodeFilter(n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                nodeFilter === n
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                  : 'text-gray-500 bg-gray-900 border border-gray-800 hover:text-gray-300'
              }`}
            >
              {n === 'all' ? 'All nodes' : n}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
        </div>
      )}

      {error && (
        <div className="text-sm text-red-400 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          Failed to list disks: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {!isLoading && !error && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-300">
              Physical Disks {sorted.length > 0 && `(${sorted.length})`}
            </span>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-gray-600 py-10 text-center">No disks found</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Device</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Node</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Vendor / Model</th>
                  <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Size</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Used By</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const health: SmartHealth = d.health ?? 'UNKNOWN';
                  return (
                    <tr
                      key={`${d.node}:${d.devpath}`}
                      onClick={() => setSelected(d)}
                      className="border-b border-gray-800/40 hover:bg-gray-800/40 cursor-pointer transition"
                    >
                      <td className="px-4 py-2.5 font-mono text-gray-200">{d.devpath}</td>
                      <td className="px-4 py-2.5 text-gray-400">{d.node}</td>
                      <td className="px-4 py-2.5 text-gray-300">
                        {d.vendor ? <span className="text-gray-500">{d.vendor} </span> : null}
                        {d.model ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                        {d.size ? formatBytes(d.size) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={diskTypeBadge(d.type)}>{d.type.toUpperCase()}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">{d.used || <span className="text-gray-600">free</span>}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={HEALTH_VARIANT[health]}>{health}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

'use client';

/**
 * ClusterSummary widget — 4 stat tiles in one row.
 *
 * Nodes online, VMs running, CTs running, total resources. Self-fetching
 * via useClusterResources so it works in any preset without props.
 */

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClusterResources } from '@/hooks/use-cluster';

export function ClusterSummaryWidget() {
  const { data: resources, isLoading } = useClusterResources();

  const nodes = resources?.filter((r) => r.type === 'node') ?? [];
  const vms = resources?.filter((r) => r.type === 'qemu') ?? [];
  const cts = resources?.filter((r) => r.type === 'lxc') ?? [];
  const onlineNodes = nodes.filter((n) => n.status === 'online').length;
  const runningVMs = vms.filter((v) => v.status === 'running').length;
  const runningCTs = cts.filter((c) => c.status === 'running').length;

  const tiles = [
    { label: 'Nodes Online', value: `${onlineNodes}/${nodes.length}`, color: 'text-[var(--color-ok)]' },
    { label: 'VMs Running', value: `${runningVMs}/${vms.length}`, color: 'text-blue-400' },
    { label: 'CTs Running', value: `${runningCTs}/${cts.length}`, color: 'text-purple-400' },
    { label: 'Total Guests', value: String(vms.length + cts.length), color: 'text-indigo-400' },
  ];

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
          Cluster Summary
        </h3>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ label, value, color }) => (
          <div key={label}>
            <p className="mb-1 text-[11px] text-[var(--color-fg-subtle)]">{label}</p>
            <p className={cn('text-2xl font-semibold tabular', color)}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

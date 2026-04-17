'use client';

/**
 * NodeRoster widget — grid of NodeCards across the cluster.
 *
 * Non-interactive variant of the dashboard's bulk-selectable grid; this
 * widget is read-only so it composes cleanly into any preset without
 * carrying page-level selection state.
 */

import { Loader2 } from 'lucide-react';
import { NodeCard } from '@/components/dashboard/node-card';
import { useClusterResources } from '@/hooks/use-cluster';

export function NodeRosterWidget() {
  const { data: resources, isLoading } = useClusterResources();

  const nodes = (resources ?? []).filter((r) => r.type === 'node');
  const vms = (resources ?? []).filter((r) => r.type === 'qemu');
  const cts = (resources ?? []).filter((r) => r.type === 'lxc');

  const vmsByNode = (name: string) => vms.filter((v) => v.node === name).length;
  const ctsByNode = (name: string) => cts.filter((c) => c.node === name).length;

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
          Nodes
        </h3>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>

      {nodes.length === 0 && !isLoading && (
        <p className="py-8 text-center text-sm text-[var(--color-fg-faint)]">No nodes.</p>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {nodes.map((node) => {
          const name = node.node ?? node.id;
          return (
            <NodeCard
              key={node.id}
              node={node}
              vmCount={vmsByNode(name)}
              ctCount={ctsByNode(name)}
            />
          );
        })}
      </div>
    </div>
  );
}

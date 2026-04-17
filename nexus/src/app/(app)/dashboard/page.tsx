'use client';

import { useClusterResources, useDefaultNode } from '@/hooks/use-cluster';
import { NodeCard } from '@/components/dashboard/node-card';
import { ResourceTree } from '@/components/dashboard/resource-tree';
import { NodeMetricsChart } from '@/components/dashboard/node-metrics-chart';
import { TaskList } from '@/components/dashboard/task-list';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import type { ClusterResourcePublic } from '@/types/proxmox';

export default function DashboardPage() {
  const { data: resources, isLoading, isError, refetch, dataUpdatedAt } = useClusterResources();
  const [selected, setSelected] = useState<ClusterResourcePublic | null>(null);
  const defaultNode = useDefaultNode();

  const nodes = resources?.filter((r) => r.type === 'node') ?? [];
  const defaultNodeResource = nodes.find((n) => (n.node ?? n.id) === defaultNode) ?? nodes[0];
  const vms = resources?.filter((r) => r.type === 'qemu') ?? [];
  const cts = resources?.filter((r) => r.type === 'lxc') ?? [];

  const vmsByNode = (nodeName: string) => vms.filter((v) => v.node === nodeName);
  const ctsByNode = (nodeName: string) => cts.filter((c) => c.node === nodeName);

  const runningVMs = vms.filter((v) => v.status === 'running').length;
  const runningCTs = cts.filter((c) => c.status === 'running').length;
  const onlineNodes = nodes.filter((n) => n.status === 'online').length;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Overview</h1>
          <p className="text-sm text-zinc-500 tabular">Cluster summary · Updated {lastUpdated}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800/60 rounded-lg text-xs text-zinc-300 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">Failed to load cluster data</p>
            <p className="text-xs text-red-400/70 mt-0.5">Check your Proxmox host connection</p>
          </div>
          <button
            onClick={() => refetch()}
            className="ml-auto text-xs text-red-400 hover:text-red-300 underline"
          >
            Retry
          </button>
        </div>
      )}

      {resources && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Nodes Online', value: `${onlineNodes}/${nodes.length}`, color: 'text-emerald-400' },
              { label: 'VMs Running', value: `${runningVMs}/${vms.length}`, color: 'text-blue-400' },
              { label: 'CTs Running', value: `${runningCTs}/${cts.length}`, color: 'text-purple-400' },
              { label: 'Total Resources', value: String(vms.length + cts.length), color: 'text-indigo-400' },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="studio-card rounded-lg px-4 py-3"
              >
                <p className="text-xs text-zinc-500 mb-1">{label}</p>
                <p className={`text-2xl font-semibold tabular ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-[280px_1fr] gap-4">
            {/* Resource tree */}
            <div className="studio-card rounded-lg p-3">
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest px-2 mb-2">
                Resource Tree
              </p>
              <ResourceTree
                resources={resources}
                selectedId={selected?.id}
                onSelect={setSelected}
              />
            </div>

            {/* Right panel */}
            <div className="space-y-4">
              {/* Node cards */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {nodes.map((node) => {
                  const name = node.node ?? node.id;
                  const isSelected = (selected?.type === 'node'
                    ? (selected.node ?? selected.id)
                    : (defaultNodeResource?.node ?? defaultNodeResource?.id)) === name;
                  return (
                    <NodeCard
                      key={node.id}
                      node={node}
                      vmCount={vmsByNode(name).length}
                      ctCount={ctsByNode(name).length}
                      selected={isSelected}
                      onClick={() => setSelected(node)}
                    />
                  );
                })}
              </div>

              {/* Metrics chart for selected node (defaults to local/main) */}
              {selected?.type === 'node' && (
                <NodeMetricsChart nodeName={selected.node ?? selected.id} />
              )}
              {!selected && defaultNodeResource && (
                <NodeMetricsChart nodeName={defaultNodeResource.node ?? defaultNodeResource.id} />
              )}

              {/* Recent tasks */}
              <TaskList />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

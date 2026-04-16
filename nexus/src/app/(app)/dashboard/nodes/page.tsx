'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useNodes, useClusterResources } from '@/hooks/use-cluster';
import { NodeMetricsChart } from '@/components/dashboard/node-metrics-chart';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatusDot } from '@/components/ui/status-dot';
import { cn, formatBytes, formatUptime, cpuPercent, memPercent } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { ClusterResourcePublic } from '@/types/proxmox';

export default function NodesPage() {
  const { data: nodes, isLoading } = useNodes();
  const { data: resources } = useClusterResources();
  const [selected, setSelected] = useState<string | null>(null);

  const selectedNode = selected ?? nodes?.[0]?.node ?? nodes?.[0]?.id ?? null;

  const vmsByNode = (name: string) =>
    resources?.filter((r) => r.type === 'qemu' && r.node === name) ?? [];
  const ctsByNode = (name: string) =>
    resources?.filter((r) => r.type === 'lxc' && r.node === name) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Nodes</h1>
        <p className="text-sm text-zinc-500">Physical and virtual cluster nodes</p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      )}

      {nodes && (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          <div className="space-y-2">
            {nodes.map((node) => {
              const name = node.node ?? node.id;
              const isSelected = selectedNode === name;
              const online = node.status === 'online';
              return (
                <button
                  key={node.id}
                  onClick={() => setSelected(name)}
                  className={cn(
                    'w-full text-left bg-zinc-900 border rounded-lg p-4 transition',
                    isSelected
                      ? 'border-zinc-300/60'
                      : 'border-zinc-800/60 hover:border-zinc-700',
                  )}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <StatusDot status={online ? 'running' : 'error'} size="md" aria-label={node.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-100 truncate">{name}</p>
                      <p className="text-xs text-zinc-500 tabular">
                        {vmsByNode(name).length} VMs · {ctsByNode(name).length} CTs
                      </p>
                    </div>
                    <span
                      className={cn(
                        'text-xs font-medium capitalize',
                        online ? 'text-emerald-400' : 'text-red-400',
                      )}
                    >
                      {node.status}
                    </span>
                  </div>
                  {online && (
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-zinc-500">CPU</span>
                          <span className="tabular font-mono text-zinc-300">{cpuPercent(node.cpu).toFixed(1)}%</span>
                        </div>
                        <ProgressBar value={cpuPercent(node.cpu)} />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-zinc-500">RAM</span>
                          <span className="tabular font-mono text-zinc-300">
                            {formatBytes(node.mem ?? 0)} / {formatBytes(node.maxmem ?? 0)}
                          </span>
                        </div>
                        <ProgressBar value={memPercent(node.mem, node.maxmem)} />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selectedNode && (
            <div className="space-y-4">
              <NodeDetailPanel node={nodes.find((n) => (n.node ?? n.id) === selectedNode)!} />
              <NodeMetricsChart nodeName={selectedNode} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NodeDetailPanel({ node }: { node: ClusterResourcePublic }) {
  const name = node.node ?? node.id;
  const { data: status, isLoading } = useQuery({
    queryKey: ['node', name, 'status'],
    queryFn: () => api.nodes.status(name),
    refetchInterval: 10_000,
  });

  return (
    <div className="studio-card p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-4">{name} — Details</h3>

      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}

      {status && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-zinc-500 mb-1">CPU</p>
              <p className="text-sm text-zinc-100 font-medium">{status.cpuinfo?.model}</p>
              <p className="text-xs text-zinc-500 tabular">
                {status.cpuinfo?.sockets} socket{status.cpuinfo?.sockets !== 1 ? 's' : ''} ·{' '}
                {status.cpuinfo?.cores} cores · {status.cpuinfo?.cpus} threads
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Memory</p>
              <p className="text-sm text-zinc-100 tabular">
                {formatBytes(status.memory?.used ?? 0)} used of {formatBytes(status.memory?.total ?? 0)}
              </p>
              <ProgressBar value={memPercent(status.memory?.used, status.memory?.total)} className="mt-2" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Swap</p>
              <p className="text-sm text-zinc-100 tabular">
                {formatBytes(status.swap?.used ?? 0)} used of {formatBytes(status.swap?.total ?? 0)}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Uptime</p>
              <p className="text-sm text-zinc-100 tabular font-mono">{formatUptime(status.uptime ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Load Average</p>
              <p className="text-sm text-zinc-100 font-mono tabular">
                {status.loadavg?.join(' · ')}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Root FS</p>
              <p className="text-sm text-zinc-100 tabular">
                {formatBytes(status.rootfs?.used ?? 0)} / {formatBytes(status.rootfs?.total ?? 0)}
              </p>
              <ProgressBar value={memPercent(status.rootfs?.used, status.rootfs?.total)} className="mt-2" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">PVE Version</p>
              <p className="text-sm text-zinc-100 font-mono">{status.pveversion}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Kernel</p>
              <p className="text-sm text-zinc-100 font-mono">{status.kversion}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

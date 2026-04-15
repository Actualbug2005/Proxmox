'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useNodes, useClusterResources } from '@/hooks/use-cluster';
import { NodeCard } from '@/components/dashboard/node-card';
import { NodeMetricsChart } from '@/components/dashboard/node-metrics-chart';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatBytes, formatUptime, cpuPercent, memPercent } from '@/lib/utils';
import { Loader2, Server, Cpu, MemoryStick, HardDrive } from 'lucide-react';
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
        <h1 className="text-xl font-semibold text-white">Nodes</h1>
        <p className="text-sm text-gray-500">Physical and virtual cluster nodes</p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        </div>
      )}

      {nodes && (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          {/* Node list */}
          <div className="space-y-2">
            {nodes.map((node) => {
              const name = node.node ?? node.id;
              const isSelected = selectedNode === name;
              return (
                <button
                  key={node.id}
                  onClick={() => setSelected(name)}
                  className={`w-full text-left bg-gray-900 border rounded-xl p-4 transition ${
                    isSelected ? 'border-orange-500/50' : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${node.status === 'online' ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                      <Server className={`w-4 h-4 ${node.status === 'online' ? 'text-emerald-400' : 'text-red-400'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{name}</p>
                      <p className="text-xs text-gray-500">
                        {vmsByNode(name).length} VMs · {ctsByNode(name).length} CTs
                      </p>
                    </div>
                    <Badge variant={node.status === 'online' ? 'success' : 'danger'} className="ml-auto">
                      {node.status}
                    </Badge>
                  </div>
                  {node.status === 'online' && (
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>CPU</span>
                          <span>{cpuPercent(node.cpu).toFixed(1)}%</span>
                        </div>
                        <ProgressBar value={cpuPercent(node.cpu)} />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>RAM</span>
                          <span>{formatBytes(node.mem ?? 0)} / {formatBytes(node.maxmem ?? 0)}</span>
                        </div>
                        <ProgressBar value={memPercent(node.mem, node.maxmem)} />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Detail panel */}
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4">{name} — Details</h3>

      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}

      {status && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">CPU</p>
              <p className="text-sm text-white">{status.cpuinfo?.model}</p>
              <p className="text-xs text-gray-500">
                {status.cpuinfo?.sockets} socket{status.cpuinfo?.sockets !== 1 ? 's' : ''} ·{' '}
                {status.cpuinfo?.cores} cores · {status.cpuinfo?.cpus} threads
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Memory</p>
              <p className="text-sm text-white">
                {formatBytes(status.memory?.used ?? 0)} used of {formatBytes(status.memory?.total ?? 0)}
              </p>
              <ProgressBar value={memPercent(status.memory?.used, status.memory?.total)} className="mt-1" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Swap</p>
              <p className="text-sm text-white">
                {formatBytes(status.swap?.used ?? 0)} used of {formatBytes(status.swap?.total ?? 0)}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Uptime</p>
              <p className="text-sm text-white">{formatUptime(status.uptime ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Load Average</p>
              <p className="text-sm text-white font-mono">
                {status.loadavg?.join(' · ')}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Root FS</p>
              <p className="text-sm text-white">
                {formatBytes(status.rootfs?.used ?? 0)} / {formatBytes(status.rootfs?.total ?? 0)}
              </p>
              <ProgressBar value={memPercent(status.rootfs?.used, status.rootfs?.total)} className="mt-1" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">PVE Version</p>
              <p className="text-sm text-white font-mono">{status.pveversion}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Kernel</p>
              <p className="text-sm text-white font-mono">{status.kversion}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

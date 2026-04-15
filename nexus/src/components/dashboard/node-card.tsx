'use client';

import { Server, Cpu, MemoryStick, HardDrive, Clock } from 'lucide-react';
import { cn, cpuPercent, formatBytes, formatUptime, memPercent } from '@/lib/utils';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Badge } from '@/components/ui/badge';
import type { ClusterResourcePublic } from '@/types/proxmox';

interface NodeCardProps {
  node: ClusterResourcePublic;
  vmCount?: number;
  ctCount?: number;
  className?: string;
}

export function NodeCard({ node, vmCount = 0, ctCount = 0, className }: NodeCardProps) {
  const cpu = cpuPercent(node.cpu);
  const mem = memPercent(node.mem, node.maxmem);
  const disk = memPercent(node.disk, node.maxdisk);
  const online = node.status === 'online';

  return (
    <div
      className={cn(
        'bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center',
              online ? 'bg-emerald-500/10' : 'bg-red-500/10',
            )}
          >
            <Server className={cn('w-4 h-4', online ? 'text-emerald-400' : 'text-red-400')} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{node.node ?? node.id}</h3>
            <p className="text-xs text-gray-500">
              {vmCount} VM{vmCount !== 1 ? 's' : ''} · {ctCount} CT{ctCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Badge variant={online ? 'success' : 'danger'}>{node.status ?? 'unknown'}</Badge>
      </div>

      {/* Metrics */}
      {online && (
        <div className="space-y-3">
          {/* CPU */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-gray-600" />
                <span className="text-xs text-gray-500">CPU</span>
              </div>
              <span className="text-xs font-mono text-gray-400">
                {cpu.toFixed(1)}% / {node.maxcpu ?? '?'} cores
              </span>
            </div>
            <ProgressBar value={cpu} />
          </div>

          {/* Memory */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <MemoryStick className="w-3 h-3 text-gray-600" />
                <span className="text-xs text-gray-500">Memory</span>
              </div>
              <span className="text-xs font-mono text-gray-400">
                {formatBytes(node.mem ?? 0)} / {formatBytes(node.maxmem ?? 0)}
              </span>
            </div>
            <ProgressBar value={mem} />
          </div>

          {/* Disk */}
          {node.maxdisk ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <HardDrive className="w-3 h-3 text-gray-600" />
                  <span className="text-xs text-gray-500">Disk</span>
                </div>
                <span className="text-xs font-mono text-gray-400">
                  {formatBytes(node.disk ?? 0)} / {formatBytes(node.maxdisk)}
                </span>
              </div>
              <ProgressBar value={disk} />
            </div>
          ) : null}

          {/* Uptime */}
          {node.uptime ? (
            <div className="flex items-center gap-1.5 pt-1">
              <Clock className="w-3 h-3 text-gray-600" />
              <span className="text-xs text-gray-500">Uptime:</span>
              <span className="text-xs text-gray-400">{formatUptime(node.uptime)}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

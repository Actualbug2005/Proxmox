'use client';

import { Cpu, MemoryStick, HardDrive, Clock } from 'lucide-react';
import { cn, cpuPercent, formatBytes, formatUptime, memPercent } from '@/lib/utils';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatusDot } from '@/components/ui/status-dot';
import type { ClusterResourcePublic } from '@/types/proxmox';

interface NodeCardProps {
  node: ClusterResourcePublic;
  vmCount?: number;
  ctCount?: number;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
}

export function NodeCard({ node, vmCount = 0, ctCount = 0, className, selected, onClick }: NodeCardProps) {
  const cpu = cpuPercent(node.cpu);
  const mem = memPercent(node.mem, node.maxmem);
  const disk = memPercent(node.disk, node.maxdisk);
  const online = node.status === 'online';
  // StatusDot speaks running/stopped; translate node states.
  const dotStatus = online ? 'running' : 'error';

  const interactive = !!onClick;

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      } : undefined}
      className={cn(
        'studio-card rounded-lg p-5 transition',
        interactive && 'cursor-pointer hover:border-white/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60',
        selected && 'border-indigo-400/40 ring-1 ring-indigo-400/30',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <StatusDot status={dotStatus} size="md" aria-label={node.status} />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{node.node ?? node.id}</h3>
            <p className="text-xs text-zinc-500 tabular">
              {vmCount} VM{vmCount !== 1 ? 's' : ''} · {ctCount} CT{ctCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'text-xs font-medium capitalize',
            online ? 'text-emerald-400' : 'text-red-400',
          )}
        >
          {node.status ?? 'unknown'}
        </span>
      </div>

      {/* Metrics */}
      {online && (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">CPU</span>
              </div>
              <span className="text-xs tabular font-mono text-zinc-300">
                {cpu.toFixed(1)}% / {node.maxcpu ?? '?'} cores
              </span>
            </div>
            <ProgressBar value={cpu} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <MemoryStick className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">Memory</span>
              </div>
              <span className="text-xs tabular font-mono text-zinc-300">
                {formatBytes(node.mem ?? 0)} / {formatBytes(node.maxmem ?? 0)}
              </span>
            </div>
            <ProgressBar value={mem} />
          </div>

          {node.maxdisk ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <HardDrive className="w-3 h-3 text-zinc-500" />
                  <span className="text-xs text-zinc-500">Disk</span>
                </div>
                <span className="text-xs tabular font-mono text-zinc-300">
                  {formatBytes(node.disk ?? 0)} / {formatBytes(node.maxdisk)}
                </span>
              </div>
              <ProgressBar value={disk} />
            </div>
          ) : null}

          {node.uptime ? (
            <div className="flex items-center gap-1.5 pt-1">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span className="text-xs text-zinc-500">Uptime:</span>
              <span className="text-xs tabular font-mono text-zinc-300">{formatUptime(node.uptime)}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

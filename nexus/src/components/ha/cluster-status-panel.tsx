'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { Badge } from '@/components/ui/badge';
import { Server, ShieldCheck, ShieldAlert, HeartPulse, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ClusterStatusPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['cluster', 'status'],
    queryFn: () => api.cluster.status(),
    refetchInterval: 15_000,
  });

  const clusterEntry = data?.find((d) => d.type === 'cluster');
  const nodeEntries = (data ?? []).filter((d) => d.type === 'node');
  const online = nodeEntries.filter((n) => n.online ?? false).length;
  const quorate = clusterEntry?.quorate ?? false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="studio-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <HeartPulse className="w-4 h-4 text-[var(--color-fg-subtle)]" />
          <span className="text-xs text-[var(--color-fg-subtle)] font-medium uppercase tracking-widest">Cluster</span>
        </div>
        <p className="text-lg font-medium text-white">{clusterEntry?.name ?? 'standalone'}</p>
        <div className="mt-2 flex items-center gap-2">
          {quorate ? (
            <Badge variant="success" className="inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> quorate</Badge>
          ) : (
            <Badge variant="danger" className="inline-flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> not quorate</Badge>
          )}
          {clusterEntry?.version ? <span className="text-xs text-[var(--color-fg-faint)]">v{clusterEntry.version}</span> : null}
        </div>
      </div>

      <div className="studio-card p-5 sm:col-span-2">
        <div className="flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-[var(--color-fg-subtle)]" />
          <span className="text-xs text-[var(--color-fg-subtle)] font-medium uppercase tracking-widest">
            Nodes {online}/{nodeEntries.length} online
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {nodeEntries.map((n) => (
            <div
              key={n.name}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs',
                n.online ?? false ? 'border-emerald-500/30 text-emerald-300' : 'border-red-500/30 text-red-300',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', n.online ?? false ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className="font-mono">{n.name}</span>
              {n.ip && <span className="text-[var(--color-fg-faint)] font-mono">{n.ip}</span>}
              {(n.local ?? false) ? <span className="text-indigo-400">(this node)</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

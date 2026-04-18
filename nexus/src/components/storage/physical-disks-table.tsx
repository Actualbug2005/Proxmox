'use client';

/**
 * Physical Disks listing across one or more nodes.
 * Fetches GET /nodes/{node}/disks/list per selected node and renders one
 * row per device. Click → SmartDetails modal.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNodes, POLL_INTERVALS } from '@/hooks/use-cluster';
import { api } from '@/lib/proxmox-client';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/ui/status-dot';
import { cn, formatBytes } from '@/lib/utils';
import { Loader2, HardDrive } from 'lucide-react';
import type { DiskListEntryPublic, SmartHealth } from '@/types/proxmox';
import { SmartDetails } from './smart-details';

interface DiskRow extends DiskListEntryPublic {
  node: string;
}

const HEALTH_DOT: Record<SmartHealth, 'running' | 'error' | 'warning'> = {
  PASSED: 'running',
  FAILED: 'error',
  UNKNOWN: 'warning',
};

const HEALTH_TEXT: Record<SmartHealth, string> = {
  PASSED: 'text-emerald-400',
  FAILED: 'text-red-400',
  UNKNOWN: 'text-amber-400',
};

function diskTypeBadge(type: DiskListEntryPublic['type']): 'info' | 'outline' {
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
    refetchInterval: POLL_INTERVALS.disks,
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
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition',
                nodeFilter === n
                  ? 'bg-white/10 text-indigo-300 ring-1 ring-inset ring-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'text-[var(--color-fg-subtle)] bg-[var(--color-surface)] ring-1 ring-inset ring-white/[0.06] hover:text-[var(--color-fg-secondary)] hover:bg-zinc-800/40',
              )}
            >
              {n === 'all' ? 'All nodes' : n}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
        </div>
      )}

      {error && (
        <div className="text-sm text-red-400 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          Failed to list disks: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {!isLoading && !error && (
        <div className="studio-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border-subtle)] flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)]" />
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
              Physical Disks {sorted.length > 0 && <span className="tabular font-mono text-[var(--color-fg-faint)]">({sorted.length})</span>}
            </span>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-faint)] py-10 text-center">No disks found</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <th className="text-left px-3 py-2 text-[var(--color-fg-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em]">Device</th>
                  <th className="text-left px-3 py-2 text-[var(--color-fg-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em]">Node</th>
                  <th className="text-left px-3 py-2 text-[var(--color-fg-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em]">Vendor / Model</th>
                  <th className="text-right px-3 py-2 text-[var(--color-fg-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em]">Size</th>
                  <th className="text-left px-3 py-2 text-[var(--color-fg-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em]">Type</th>
                  <th className="text-left px-3 py-2 text-[var(--color-fg-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em]">Used By</th>
                  <th className="text-left px-3 py-2 text-[var(--color-fg-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em]">Health</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const health: SmartHealth = d.health ?? 'UNKNOWN';
                  return (
                    <tr
                      key={`${d.node}:${d.devpath}`}
                      onClick={() => setSelected(d)}
                      className="border-b border-white/[0.03] hover:bg-zinc-800/40 cursor-pointer transition"
                    >
                      <td className="px-3 py-2 tabular font-mono text-data text-[var(--color-fg-secondary)]">{d.devpath}</td>
                      <td className="px-3 py-2 text-data text-[var(--color-fg-muted)]">{d.node}</td>
                      <td className="px-3 py-2 text-data text-[var(--color-fg-secondary)]">
                        {d.vendor ? <span className="text-[var(--color-fg-subtle)]">{d.vendor} </span> : null}
                        {d.model ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular font-mono text-data text-[var(--color-fg-secondary)]">
                        {d.size ? formatBytes(d.size) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={diskTypeBadge(d.type)}>{d.type.toUpperCase()}</Badge>
                      </td>
                      <td className="px-3 py-2 text-data text-[var(--color-fg-muted)]">{d.used || <span className="text-[var(--color-fg-faint)]">free</span>}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <StatusDot status={HEALTH_DOT[health]} size="sm" aria-label={`SMART ${health}`} />
                          <span className={cn('text-data font-medium', HEALTH_TEXT[health])}>{health}</span>
                        </div>
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

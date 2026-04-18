'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useClusterResources } from '@/hooks/use-cluster';
import { Gauge } from '@/components/ui/gauge';
import { StatusDot } from '@/components/ui/status-dot';
import { SortTh } from '@/components/dashboard/sort-th';
import { cpuPercent, formatBytes, memPercent, formatUptime } from '@/lib/utils';
import {
  Play, Square, RotateCcw, PowerOff, Plus, Loader2,
  Box, Search,
} from 'lucide-react';
import type { ClusterResourcePublic } from '@/types/proxmox';

type SortKey = 'vmid' | 'name' | 'status' | 'node' | 'cpu' | 'mem';

function CTActions({ ct, onDone }: { ct: ClusterResourcePublic; onDone: () => void }) {
  const qc = useQueryClient();
  const node = ct.node ?? '';
  const vmid = ct.vmid ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
    onDone();
  };

  const start = useMutation({ mutationFn: () => api.containers.start(node, vmid), onSuccess: invalidate });
  const shutdown = useMutation({ mutationFn: () => api.containers.shutdown(node, vmid), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => api.containers.stop(node, vmid), onSuccess: invalidate });
  const reboot = useMutation({ mutationFn: () => api.containers.reboot(node, vmid), onSuccess: invalidate });

  const running = ct.status === 'running';
  const stopped = ct.status === 'stopped';
  const pending = start.isPending || shutdown.isPending || stop.isPending || reboot.isPending;

  return (
    <div className="flex items-center gap-1">
      {stopped && (
        <button
          onClick={(e) => { e.stopPropagation(); start.mutate(); }}
          disabled={pending}
          title="Start"
          className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-emerald-400 hover:bg-emerald-500/10 transition disabled:opacity-40"
        >
          {start.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        </button>
      )}
      {running && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); shutdown.mutate(); }}
            disabled={pending}
            title="Shutdown"
            className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-amber-400 hover:bg-amber-500/10 transition disabled:opacity-40"
          >
            {shutdown.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); reboot.mutate(); }}
            disabled={pending}
            title="Reboot"
            className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-blue-400 hover:bg-blue-500/10 transition disabled:opacity-40"
          >
            {reboot.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); stop.mutate(); }}
            disabled={pending}
            title="Force Stop"
            className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-40"
          >
            {stop.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
          </button>
        </>
      )}
    </div>
  );
}

export default function CTsPage() {
  const router = useRouter();
  const { data: resources, isLoading } = useClusterResources();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('vmid');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [, setTick] = useState(0);

  const cts = (resources ?? []).filter((r) => r.type === 'lxc');

  const filtered = cts.filter((ct) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(ct.vmid).includes(q) ||
      (ct.name ?? '').toLowerCase().includes(q) ||
      (ct.node ?? '').toLowerCase().includes(q) ||
      (ct.status ?? '').includes(q)
    );
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = 0, vb: string | number = 0;
    switch (sortKey) {
      case 'vmid': va = a.vmid ?? 0; vb = b.vmid ?? 0; break;
      case 'name': va = a.name ?? ''; vb = b.name ?? ''; break;
      case 'status': va = a.status ?? ''; vb = b.status ?? ''; break;
      case 'node': va = a.node ?? ''; vb = b.node ?? ''; break;
      case 'cpu': va = a.cpu ?? 0; vb = b.cpu ?? 0; break;
      case 'mem': va = a.mem ?? 0; vb = b.mem ?? 0; break;
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const runningCount = cts.filter((c) => c.status === 'running').length;
  const stoppedCount = cts.filter((c) => c.status === 'stopped').length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">Containers</h1>
          <p className="text-sm text-[var(--color-fg-subtle)] mt-0.5 tabular">
            {cts.length} total · {runningCount} running · {stoppedCount} stopped
          </p>
        </div>
        <Link
          href="/dashboard/cts/create"
          className="flex items-center gap-2 px-4 py-2 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm font-medium rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          Create CT
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)]" />
        <input
          type="text"
          placeholder="Search by name, ID, node, status…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 studio-card text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50 focus:ring-1 focus:ring-zinc-300/20"
        />
      </div>

      <div className="studio-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-fg-muted)]" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[var(--color-fg-faint)]">
            <Box className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">{search ? 'No containers match your search' : 'No containers found'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
              <tr>
                <SortTh label="ID" k="vmid" align="right" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <SortTh label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <SortTh label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <SortTh label="Node" k="node" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">CPU</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">Memory</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">Disk</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">Uptime</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {sorted.map((ct) => {
                const cpu = cpuPercent(ct.cpu);
                const mem = memPercent(ct.mem, ct.maxmem);
                const disk = memPercent(ct.disk, ct.maxdisk);
                return (
                  <tr
                    key={ct.id}
                    onClick={() => router.push(`/dashboard/cts/${ct.node}/${ct.vmid}`)}
                    className="hover:bg-zinc-800/40 cursor-pointer transition group"
                  >
                    <td className="px-3 py-3 text-sm tabular font-mono text-right text-[var(--color-fg-subtle)]">{ct.vmid}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <StatusDot status={ct.status} size="sm" />
                        <span className="text-sm font-medium text-[var(--color-fg)] group-hover:text-white transition">
                          {ct.name ?? `CT ${ct.vmid}`}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm text-[var(--color-fg-secondary)] capitalize">
                        {ct.status ?? 'unknown'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-[var(--color-fg-muted)]">{ct.node}</td>
                    <td className="px-3 py-3 w-32">
                      {ct.status === 'running' ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm tabular font-mono text-[var(--color-fg-secondary)]">{cpu.toFixed(1)}%</span>
                          <Gauge value={cpu} label="CPU usage" />
                        </div>
                      ) : <div className="text-xs text-right text-[var(--color-fg-faint)]">—</div>}
                    </td>
                    <td className="px-3 py-3 w-40">
                      {ct.status === 'running' && ct.maxmem ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm tabular font-mono text-[var(--color-fg-secondary)] whitespace-nowrap">
                            {formatBytes(ct.mem ?? 0)} <span className="text-[var(--color-fg-faint)]">/</span> {formatBytes(ct.maxmem)}
                          </span>
                          <Gauge value={mem} label="Memory usage" />
                        </div>
                      ) : <div className="text-xs text-right text-[var(--color-fg-faint)]">—</div>}
                    </td>
                    <td className="px-3 py-3 w-40">
                      {ct.maxdisk ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm tabular font-mono text-[var(--color-fg-secondary)] whitespace-nowrap">
                            {formatBytes(ct.disk ?? 0)} <span className="text-[var(--color-fg-faint)]">/</span> {formatBytes(ct.maxdisk)}
                          </span>
                          <Gauge value={disk} label="Disk usage" />
                        </div>
                      ) : <div className="text-xs text-right text-[var(--color-fg-faint)]">—</div>}
                    </td>
                    <td className="px-3 py-3 text-sm tabular font-mono text-right text-[var(--color-fg-muted)]">
                      {ct.uptime ? formatUptime(ct.uptime) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <CTActions ct={ct} onDone={() => setTick((t) => t + 1)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

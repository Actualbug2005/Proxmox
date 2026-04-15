'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useClusterResources } from '@/hooks/use-cluster';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { cn, cpuPercent, formatBytes, memPercent, formatUptime } from '@/lib/utils';
import {
  Play, Square, RotateCcw, PowerOff, Plus, Loader2,
  Box, Circle, ChevronDown, Search,
} from 'lucide-react';
import type { ClusterResourcePublic } from '@/types/proxmox';

type SortKey = 'vmid' | 'name' | 'status' | 'node' | 'cpu' | 'mem';

function statusVariant(status?: string): 'success' | 'danger' | 'warning' | 'outline' {
  switch (status) {
    case 'running': return 'success';
    case 'stopped': return 'danger';
    case 'paused': case 'suspended': return 'warning';
    default: return 'outline';
  }
}

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
          className="p-1.5 rounded-md text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition disabled:opacity-40"
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
            className="p-1.5 rounded-md text-gray-500 hover:text-yellow-400 hover:bg-yellow-500/10 transition disabled:opacity-40"
          >
            {shutdown.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); reboot.mutate(); }}
            disabled={pending}
            title="Reboot"
            className="p-1.5 rounded-md text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition disabled:opacity-40"
          >
            {reboot.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); stop.mutate(); }}
            disabled={pending}
            title="Force Stop"
            className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-40"
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

  function SortTh({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className={cn(
          'px-4 py-3 text-left text-xs font-medium cursor-pointer select-none whitespace-nowrap',
          active ? 'text-orange-400' : 'text-gray-500 hover:text-gray-300',
        )}
      >
        {label}
        {active && <ChevronDown className={cn('inline w-3 h-3 ml-1', sortDir === 'desc' && 'rotate-180')} />}
      </th>
    );
  }

  const runningCount = cts.filter((c) => c.status === 'running').length;
  const stoppedCount = cts.filter((c) => c.status === 'stopped').length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Containers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {cts.length} total · {runningCount} running · {stoppedCount} stopped
          </p>
        </div>
        <Link
          href="/dashboard/cts/create"
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          Create CT
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search by name, ID, node, status…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-orange-500/50"
        />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-600">
            <Box className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">{search ? 'No containers match your search' : 'No containers found'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-gray-800">
              <tr>
                <SortTh label="ID" k="vmid" />
                <SortTh label="Name" k="name" />
                <SortTh label="Status" k="status" />
                <SortTh label="Node" k="node" />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">CPU</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Memory</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Disk</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Uptime</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {sorted.map((ct) => {
                const cpu = cpuPercent(ct.cpu);
                const mem = memPercent(ct.mem, ct.maxmem);
                const disk = memPercent(ct.disk, ct.maxdisk);
                return (
                  <tr
                    key={ct.id}
                    onClick={() => router.push(`/dashboard/cts/${ct.node}/${ct.vmid}`)}
                    className="hover:bg-gray-800/50 cursor-pointer transition group"
                  >
                    <td className="px-4 py-3 text-sm font-mono text-gray-400">{ct.vmid}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Box className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition">
                          {ct.name ?? `CT ${ct.vmid}`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(ct.status)}>
                        <Circle className="w-1.5 h-1.5 mr-1 fill-current" />
                        {ct.status ?? 'unknown'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{ct.node}</td>
                    <td className="px-4 py-3 w-32">
                      {ct.status === 'running' ? (
                        <div>
                          <span className="text-xs text-gray-400 tabular-nums">{cpu.toFixed(1)}%</span>
                          <ProgressBar value={cpu} className="mt-1" />
                        </div>
                      ) : <span className="text-xs text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 w-36">
                      {ct.status === 'running' && ct.maxmem ? (
                        <div>
                          <span className="text-xs text-gray-400 tabular-nums">
                            {formatBytes(ct.mem ?? 0)} / {formatBytes(ct.maxmem)}
                          </span>
                          <ProgressBar value={mem} className="mt-1" />
                        </div>
                      ) : <span className="text-xs text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 w-32">
                      {ct.maxdisk ? (
                        <div>
                          <span className="text-xs text-gray-400 tabular-nums">
                            {formatBytes(ct.disk ?? 0)} / {formatBytes(ct.maxdisk)}
                          </span>
                          <ProgressBar value={disk} className="mt-1" />
                        </div>
                      ) : <span className="text-xs text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400 tabular-nums">
                      {ct.uptime ? formatUptime(ct.uptime) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useClusterResources } from '@/hooks/use-cluster';
import { Badge } from '@/components/ui/badge';
import { Gauge } from '@/components/ui/gauge';
import { StatusDot } from '@/components/ui/status-dot';
import { cn, cpuPercent, formatBytes, memPercent, formatUptime } from '@/lib/utils';
import {
  Play, Square, RotateCcw, PowerOff, Plus, Loader2,
  Monitor, ChevronDown, Search,
} from 'lucide-react';
import type { ClusterResourcePublic } from '@/types/proxmox';

type SortKey = 'vmid' | 'name' | 'status' | 'node' | 'cpu' | 'mem';

function VMActions({ vm, onDone }: { vm: ClusterResourcePublic; onDone: () => void }) {
  const qc = useQueryClient();
  const node = vm.node ?? '';
  const vmid = vm.vmid ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
    onDone();
  };

  const start = useMutation({ mutationFn: () => api.vms.start(node, vmid), onSuccess: invalidate });
  const shutdown = useMutation({ mutationFn: () => api.vms.shutdown(node, vmid), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => api.vms.stop(node, vmid), onSuccess: invalidate });
  const reboot = useMutation({ mutationFn: () => api.vms.reboot(node, vmid), onSuccess: invalidate });

  const running = vm.status === 'running';
  const stopped = vm.status === 'stopped';
  const pending = start.isPending || shutdown.isPending || stop.isPending || reboot.isPending;

  return (
    <div className="flex items-center gap-1">
      {stopped && (
        <button
          onClick={(e) => { e.stopPropagation(); start.mutate(); }}
          disabled={pending}
          title="Start"
          className="p-1.5 rounded-md text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition disabled:opacity-40"
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
            className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 transition disabled:opacity-40"
          >
            {shutdown.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); reboot.mutate(); }}
            disabled={pending}
            title="Reboot"
            className="p-1.5 rounded-md text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 transition disabled:opacity-40"
          >
            {reboot.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); stop.mutate(); }}
            disabled={pending}
            title="Force Stop"
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-40"
          >
            {stop.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
          </button>
        </>
      )}
    </div>
  );
}

export default function VMsPage() {
  const router = useRouter();
  const { data: resources, isLoading } = useClusterResources();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('vmid');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [, setTick] = useState(0); // force re-render after mutation

  const vms = (resources ?? []).filter((r) => r.type === 'qemu');

  const filtered = vms.filter((vm) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(vm.vmid).includes(q) ||
      (vm.name ?? '').toLowerCase().includes(q) ||
      (vm.node ?? '').toLowerCase().includes(q) ||
      (vm.status ?? '').includes(q)
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

  function SortTh({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className={cn(
          'px-3 py-3 text-[11px] font-semibold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap',
          align === 'right' ? 'text-right' : 'text-left',
          active ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-300',
        )}
      >
        {label}
        {active && <ChevronDown className={cn('inline w-3 h-3 ml-1', sortDir === 'desc' && 'rotate-180')} />}
      </th>
    );
  }

  const runningCount = vms.filter((v) => v.status === 'running').length;
  const stoppedCount = vms.filter((v) => v.status === 'stopped').length;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Virtual Machines</h1>
          <p className="text-sm text-zinc-500 mt-0.5 tabular">
            {vms.length} total · {runningCount} running · {stoppedCount} stopped
          </p>
        </div>
        <Link
          href="/dashboard/vms/create"
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition shadow-[0_0_20px_-6px_rgba(249,115,22,0.5)]"
        >
          <Plus className="w-4 h-4" />
          Create VM
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search by name, ID, node, status…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
        />
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
            <Monitor className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">{search ? 'No VMs match your search' : 'No virtual machines found'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-zinc-800/60 bg-zinc-900">
              <tr>
                <SortTh label="ID" k="vmid" align="right" />
                <SortTh label="Name" k="name" />
                <SortTh label="Status" k="status" />
                <SortTh label="Node" k="node" />
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-zinc-500">CPU</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Memory</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Disk</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Uptime</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {sorted.map((vm) => {
                const cpu = cpuPercent(vm.cpu);
                const mem = memPercent(vm.mem, vm.maxmem);
                const disk = memPercent(vm.disk, vm.maxdisk);
                return (
                  <tr
                    key={vm.id}
                    onClick={() => router.push(`/dashboard/vms/${vm.node}/${vm.vmid}`)}
                    className="hover:bg-zinc-800/40 cursor-pointer transition group"
                  >
                    <td className="px-3 py-3 text-sm tabular font-mono text-right text-zinc-500">{vm.vmid}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <StatusDot status={vm.status} size="sm" />
                        <span className="text-sm font-medium text-zinc-100 group-hover:text-white transition">
                          {vm.name ?? `VM ${vm.vmid}`}
                        </span>
                        {(vm.template ?? false) && (
                          <Badge variant="info">template</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm text-zinc-300 capitalize">
                        {vm.status ?? 'unknown'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-zinc-400">{vm.node}</td>
                    <td className="px-3 py-3 w-32">
                      {vm.status === 'running' ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm tabular font-mono text-zinc-200">{cpu.toFixed(1)}%</span>
                          <Gauge value={cpu} label="CPU usage" />
                        </div>
                      ) : <div className="text-xs text-right text-zinc-600">—</div>}
                    </td>
                    <td className="px-3 py-3 w-40">
                      {vm.status === 'running' && vm.maxmem ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm tabular font-mono text-zinc-200 whitespace-nowrap">
                            {formatBytes(vm.mem ?? 0)} <span className="text-zinc-600">/</span> {formatBytes(vm.maxmem)}
                          </span>
                          <Gauge value={mem} label="Memory usage" />
                        </div>
                      ) : <div className="text-xs text-right text-zinc-600">—</div>}
                    </td>
                    <td className="px-3 py-3 w-40">
                      {vm.maxdisk ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm tabular font-mono text-zinc-200 whitespace-nowrap">
                            {formatBytes(vm.disk ?? 0)} <span className="text-zinc-600">/</span> {formatBytes(vm.maxdisk)}
                          </span>
                          <Gauge value={disk} label="Disk usage" />
                        </div>
                      ) : <div className="text-xs text-right text-zinc-600">—</div>}
                    </td>
                    <td className="px-3 py-3 text-sm tabular font-mono text-right text-zinc-400">
                      {vm.uptime ? formatUptime(vm.uptime) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <VMActions vm={vm} onDone={() => setTick((t) => t + 1)} />
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

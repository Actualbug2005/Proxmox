'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { cpuPercent, formatBytes, memPercent, formatUptime, cn } from '@/lib/utils';
import {
  Play, Square, RotateCcw, PowerOff, Loader2, ChevronLeft,
  Monitor, Copy, MoveRight, Trash2, Terminal, Server,
  Cpu, MemoryStick, HardDrive, Network, Save, ExternalLink,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { VMMetricsChart } from '@/components/dashboard/vm-metrics-chart';
import { SnapshotsTab } from '@/components/dashboard/snapshots-tab';
import { BackupsTab } from '@/components/dashboard/backups-tab';
import { TabBar } from '@/components/dashboard/tab-bar';
import { FirewallRulesTab } from '@/components/firewall/firewall-rules-tab';
import { FirewallOptionsTab } from '@/components/firewall/firewall-options-tab';
import type { UpdateVMConfigParamsPublic } from '@/types/proxmox';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(status?: string): 'success' | 'danger' | 'warning' | 'outline' {
  switch (status) {
    case 'running': return 'success';
    case 'stopped': return 'danger';
    case 'paused': case 'suspended': return 'warning';
    default: return 'outline';
  }
}

function parseKV(str?: string): Record<string, string> {
  if (!str) return {};
  return Object.fromEntries(
    str.split(',').map((p) => {
      const idx = p.indexOf('=');
      return idx >= 0 ? [p.slice(0, idx), p.slice(idx + 1)] : [p, ''];
    }),
  );
}

// ── Clone dialog ──────────────────────────────────────────────────────────────

function CloneDialog({
  currentName, onConfirm, onCancel, isLoading,
}: {
  currentName: string; isLoading: boolean;
  onConfirm: (newid: number, name: string, full: boolean) => void;
  onCancel: () => void;
}) {
  const [newid, setNewid] = useState('');
  const [name, setName] = useState(`${currentName}-clone`);
  const [full, setFull] = useState(true);
  const { data: nextid } = useQuery({ queryKey: ['nextid'], queryFn: () => api.cluster.nextid() });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-sm font-semibold text-white mb-4">Clone VM</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">New VM ID</label>
            <input
              type="number"
              placeholder={String(nextid ?? '...')}
              value={newid}
              onChange={(e) => setNewid(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)}
              className="rounded border-gray-600" />
            Full clone (copy disks)
          </label>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(Number(newid) || (nextid ?? 0), name, full)}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Migrate dialog ────────────────────────────────────────────────────────────

function MigrateDialog({
  currentNode, isRunning, onConfirm, onCancel, isLoading,
}: {
  currentNode: string; isRunning: boolean; isLoading: boolean;
  onConfirm: (target: string, online: boolean) => void;
  onCancel: () => void;
}) {
  const { data: resources } = useQuery({
    queryKey: ['cluster', 'resources'],
    queryFn: () => api.cluster.resources(),
  });
  const nodes = (resources ?? []).filter((r) => r.type === 'node' && (r.node ?? r.id) !== currentNode);
  const [target, setTarget] = useState('');
  const [online, setOnline] = useState(isRunning);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-sm font-semibold text-white mb-4">Migrate VM</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Target Node</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50"
            >
              <option value="">Select node…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.node ?? n.id}>{n.node ?? n.id}</option>
              ))}
            </select>
          </div>
          {isRunning && (
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)}
                className="rounded border-gray-600" />
              Online migration (live)
            </label>
          )}
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition">
            Cancel
          </button>
          <button
            onClick={() => target && onConfirm(target, online)}
            disabled={!target || isLoading}
            className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Migrate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VMDetailPage({ params }: { params: Promise<{ node: string; vmid: string }> }) {
  const { node, vmid: vmidStr } = use(params);
  const vmid = parseInt(vmidStr, 10);
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'summary' | 'hardware' | 'snapshots' | 'backups' | 'firewall' | 'metrics'>('summary');
  const [showDelete, setShowDelete] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);
  const [editConfig, setEditConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<UpdateVMConfigParamsPublic>({});

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['vm', node, vmid, 'status'],
    queryFn: () => api.vms.status(node, vmid),
    refetchInterval: 5_000,
  });

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['vm', node, vmid, 'config'],
    queryFn: () => api.vms.config(node, vmid),
  });

  const { data: tasks } = useQuery({
    queryKey: ['vm', node, vmid, 'tasks'],
    queryFn: () => api.nodes.tasks(node),
    select: (data) => data.filter((t) => t.id === String(vmid)).slice(0, 10),
    refetchInterval: 10_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['vm', node, vmid, 'status'] });
    qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
  };

  const startM = useMutation({ mutationFn: () => api.vms.start(node, vmid), onSuccess: invalidate });
  const shutdownM = useMutation({ mutationFn: () => api.vms.shutdown(node, vmid), onSuccess: invalidate });
  const stopM = useMutation({ mutationFn: () => api.vms.stop(node, vmid), onSuccess: invalidate });
  const rebootM = useMutation({ mutationFn: () => api.vms.reboot(node, vmid), onSuccess: invalidate });
  const deleteM = useMutation({
    mutationFn: () => api.vms.delete(node, vmid),
    onSuccess: () => {
      // Purge the deleted VM from the cluster-resources cache *before*
      // navigating — same rationale as the CT page.
      qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
      router.push('/dashboard/vms');
    },
  });
  const cloneM = useMutation({
    mutationFn: (p: { newid: number; name: string; full: boolean }) =>
      api.vms.clone(node, vmid, { newid: p.newid, name: p.name, full: p.full }),
    onSuccess: () => { setShowClone(false); qc.invalidateQueries({ queryKey: ['cluster', 'resources'] }); },
  });
  const migrateM = useMutation({
    mutationFn: (p: { target: string; online: boolean }) =>
      api.vms.migrate(node, vmid, { target: p.target, online: p.online }),
    onSuccess: () => { setShowMigrate(false); router.push('/dashboard/vms'); },
  });
  const saveConfigM = useMutation({
    mutationFn: () => api.vms.updateConfig(node, vmid, configDraft),
    onSuccess: () => {
      setEditConfig(false);
      setConfigDraft({});
      qc.invalidateQueries({ queryKey: ['vm', node, vmid, 'config'] });
    },
  });

  const isRunning = status?.status === 'running';
  const isStopped = status?.status === 'stopped';
  const anyPending = startM.isPending || shutdownM.isPending || stopM.isPending || rebootM.isPending;

  const cpu = cpuPercent(status?.cpu);
  const mem = memPercent(status?.mem, status?.maxmem);
  const disk = memPercent(status?.disk, status?.maxdisk);

  const vmName = status?.name ?? config?.name ?? `VM ${vmid}`;

  // parse disk/net config strings
  const diskSlots = config
    ? (['scsi0','scsi1','scsi2','scsi3','ide0','ide2','sata0','virtio0','virtio1'] as const)
        .filter((k) => config[k])
        .map((k) => ({ key: k, value: config[k]! }))
    : [];
  const netSlots = config
    ? (['net0','net1','net2','net3'] as const)
        .filter((k) => config[k])
        .map((k) => ({ key: k, value: config[k]! }))
    : [];

  const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'hardware', label: 'Hardware' },
    { id: 'snapshots', label: 'Snapshots' },
    { id: 'backups', label: 'Backups' },
    { id: 'firewall', label: 'Firewall' },
    { id: 'metrics', label: 'Metrics' },
  ] as const;

  return (
    <div className="p-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/dashboard/vms" className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition">
          <ChevronLeft className="w-3.5 h-3.5" />
          Virtual Machines
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-300">{vmName}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center',
            isRunning ? 'bg-emerald-500/10' : 'bg-zinc-800')}>
            <Monitor className={cn('w-5 h-5', isRunning ? 'text-emerald-400' : 'text-zinc-500')} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-white">{vmName}</h1>
              <Badge variant={statusVariant(status?.status)}>
                {status?.status ?? 'unknown'}
              </Badge>
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">
              VMID {vmid} · <span className="inline-flex items-center gap-1"><Server className="w-3 h-3" />{node}</span>
              {config?.ostype && <> · {config.ostype}</>}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isStopped && (
            <button onClick={() => startM.mutate()} disabled={anyPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm rounded-lg transition disabled:opacity-40">
              {startM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start
            </button>
          )}
          {isRunning && (
            <>
              <button onClick={() => shutdownM.mutate()} disabled={anyPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-sm rounded-lg transition disabled:opacity-40">
                {shutdownM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
                Shutdown
              </button>
              <button onClick={() => rebootM.mutate()} disabled={anyPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm rounded-lg transition disabled:opacity-40">
                {rebootM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Reboot
              </button>
              <button onClick={() => stopM.mutate()} disabled={anyPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-lg transition disabled:opacity-40">
                {stopM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                Stop
              </button>
            </>
          )}
          <Link
            href={`/console?node=${node}&vmid=${vmid}&type=qemu`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-800 text-zinc-300 text-sm rounded-lg transition"
          >
            <Terminal className="w-4 h-4" />
            Console
          </Link>
          <a
            href={`/console/vnc?node=${encodeURIComponent(node)}&vmid=${vmid}&type=qemu`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-800 border border-zinc-800/60 text-zinc-300 text-sm rounded-lg transition"
            title="Open graphical console in a new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Graphical Console
          </a>
          <button onClick={() => setShowClone(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-800 text-zinc-300 text-sm rounded-lg transition">
            <Copy className="w-4 h-4" />
            Clone
          </button>
          <button onClick={() => setShowMigrate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-800 text-zinc-300 text-sm rounded-lg transition">
            <MoveRight className="w-4 h-4" />
            Migrate
          </button>
          <button onClick={() => setShowDelete(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-lg transition">
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800/60">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition -mb-px',
              tab === t.id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary tab */}
      {tab === 'summary' && (
        <div className="space-y-4">
          {statusLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          ) : status ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* CPU */}
              <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Cpu className="w-4 h-4 text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-400">CPU</span>
                </div>
                <p className="text-2xl font-semibold text-white tabular-nums">{cpu.toFixed(1)}%</p>
                <ProgressBar value={cpu} className="mt-2" />
                <p className="text-xs text-zinc-600 mt-1">{status.cpus ?? status.maxcpu ?? '?'} vCPUs</p>
              </div>
              {/* Memory */}
              <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MemoryStick className="w-4 h-4 text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-400">Memory</span>
                </div>
                <p className="text-2xl font-semibold text-white">{formatBytes(status.mem ?? 0)}</p>
                <ProgressBar value={mem} className="mt-2" />
                <p className="text-xs text-zinc-600 mt-1">of {formatBytes(status.maxmem ?? 0)}</p>
              </div>
              {/* Disk */}
              <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <HardDrive className="w-4 h-4 text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-400">Disk</span>
                </div>
                <p className="text-2xl font-semibold text-white">{formatBytes(status.disk ?? 0)}</p>
                <ProgressBar value={disk} className="mt-2" />
                <p className="text-xs text-zinc-600 mt-1">of {formatBytes(status.maxdisk ?? 0)}</p>
              </div>
              {/* Network */}
              <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Network className="w-4 h-4 text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-400">Network I/O</span>
                </div>
                <p className="text-sm font-medium text-white">↑ {formatBytes(status.netout ?? 0)}</p>
                <p className="text-sm font-medium text-white mt-1">↓ {formatBytes(status.netin ?? 0)}</p>
                {status.uptime != null && (
                  <p className="text-xs text-zinc-600 mt-2">Up {formatUptime(status.uptime)}</p>
                )}
              </div>
            </div>
          ) : null}

          {/* Recent tasks */}
          {tasks && tasks.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/60">
                <h3 className="text-sm font-medium text-zinc-300">Recent Tasks</h3>
              </div>
              <table className="w-full">
                <tbody className="divide-y divide-zinc-800/60/60">
                  {tasks.map((t) => (
                    <tr key={t.upid} className="px-4">
                      <td className="px-4 py-2.5 text-xs font-mono text-zinc-400">{t.type}</td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">
                        {new Date(t.starttime * 1000).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={t.exitstatus === 'OK' ? 'success' : t.exitstatus ? 'danger' : 'info'}>
                          {t.exitstatus ?? 'running'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Hardware tab */}
      {tab === 'hardware' && (
        <div className="space-y-4">
          {configLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          ) : config ? (
            <>
              {/* Editable fields */}
              <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white">General</h3>
                  {!editConfig ? (
                    <button onClick={() => { setConfigDraft({ name: config.name, cores: config.cores, sockets: config.sockets, memory: config.memory, onboot: config.onboot, description: config.description }); setEditConfig(true); }}
                      className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded-lg transition">
                      Edit
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => { setEditConfig(false); setConfigDraft({}); }}
                        className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-800 text-zinc-400 rounded-lg transition">
                        Cancel
                      </button>
                      <button onClick={() => saveConfigM.mutate()} disabled={saveConfigM.isPending}
                        className="flex items-center gap-1.5 text-xs px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50">
                        {saveConfigM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {(['name', 'cores', 'sockets', 'memory', 'onboot', 'description'] as const).map((field) => (
                    <div key={field}>
                      <label className="text-xs text-zinc-500 capitalize block mb-1">
                        {field === 'onboot' ? 'Start at Boot' : field === 'memory' ? 'Memory (MB)' : field}
                      </label>
                      {editConfig ? (
                        field === 'onboot' ? (
                          <input type="checkbox"
                            checked={!!configDraft.onboot}
                            onChange={(e) => setConfigDraft((d) => ({ ...d, onboot: e.target.checked }))}
                            className="rounded border-gray-600" />
                        ) : (
                          <input
                            type={['cores','sockets','memory'].includes(field) ? 'number' : 'text'}
                            value={String(configDraft[field as keyof UpdateVMConfigParamsPublic] ?? '')}
                            onChange={(e) => setConfigDraft((d) => ({
                              ...d,
                              [field]: ['cores','sockets','memory'].includes(field) ? Number(e.target.value) : e.target.value,
                            }))}
                            className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50"
                          />
                        )
                      ) : (
                        <p className="text-sm text-zinc-200">
                          {field === 'onboot'
                            ? (config.onboot ? 'Yes' : 'No')
                            : String(config[field as keyof typeof config] ?? '—')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Disks */}
              {diskSlots.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">Disks</h3>
                  <div className="space-y-2">
                    {diskSlots.map(({ key, value }) => {
                      const kv = parseKV(value);
                      const [location] = value.split(',');
                      return (
                        <div key={key} className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg">
                          <HardDrive className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-mono text-zinc-400 mb-0.5">{key}</p>
                            <p className="text-sm text-zinc-200">{location}</p>
                            {kv.size && <p className="text-xs text-zinc-500">Size: {kv.size}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Network */}
              {netSlots.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">Network</h3>
                  <div className="space-y-2">
                    {netSlots.map(({ key, value }) => {
                      const kv = parseKV(value);
                      return (
                        <div key={key} className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg">
                          <Network className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-mono text-zinc-400 mb-0.5">{key}</p>
                            <p className="text-sm text-zinc-200">{kv.bridge ?? '—'}</p>
                            <p className="text-xs text-zinc-500 font-mono">{kv.virtio ?? kv.e1000 ?? kv.rtl8139 ?? ''}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Snapshots tab */}
      {tab === 'snapshots' && (
        <SnapshotsTab kind="qemu" node={node} vmid={vmid} />
      )}

      {/* Backups tab */}
      {tab === 'backups' && (
        <BackupsTab kind="qemu" node={node} vmid={vmid} />
      )}

      {/* Firewall tab */}
      {tab === 'firewall' && (
        <VMFirewallSubtabs node={node} vmid={vmid} kind="vm" />
      )}

      {/* Metrics tab */}
      {tab === 'metrics' && (
        <VMMetricsChart node={node} vmid={vmid} type="qemu" />
      )}

      {/* Dialogs */}
      {showDelete && (
        <ConfirmDialog
          title="Delete VM"
          message={`Permanently delete "${vmName}" (${vmid}) and all its disks? This cannot be undone.`}
          danger
          onConfirm={() => deleteM.mutate()}
          onCancel={() => setShowDelete(false)}
        />
      )}
      {showClone && (
        <CloneDialog
          currentName={vmName}
          isLoading={cloneM.isPending}
          onConfirm={(newid, name, full) => cloneM.mutate({ newid, name, full })}
          onCancel={() => setShowClone(false)}
        />
      )}
      {showMigrate && (
        <MigrateDialog
          currentNode={node}
          isRunning={isRunning}
          isLoading={migrateM.isPending}
          onConfirm={(target, online) => migrateM.mutate({ target, online })}
          onCancel={() => setShowMigrate(false)}
        />
      )}
    </div>
  );
}

// ── Firewall subtabs ──────────────────────────────────────────────────────────

function VMFirewallSubtabs({ node, vmid, kind }: { node: string; vmid: number; kind: 'vm' | 'ct' }) {
  const [sub, setSub] = useState<'rules' | 'options'>('rules');
  const scope = { kind, node, vmid } as const;
  return (
    <div className="space-y-4">
      <TabBar
        tabs={[{ id: 'rules', label: 'Rules' }, { id: 'options', label: 'Options' }]}
        value={sub}
        onChange={setSub}
      />
      {sub === 'rules' ? <FirewallRulesTab scope={scope} /> : <FirewallOptionsTab scope={scope} />}
    </div>
  );
}

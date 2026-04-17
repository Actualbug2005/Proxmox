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
  Box, Copy, MoveRight, Trash2, Terminal, Server,
  Cpu, MemoryStick, HardDrive, Network, Save, ExternalLink,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { MigrateWizard } from '@/components/migrate/migrate-wizard';
import { VMMetricsChart } from '@/components/dashboard/vm-metrics-chart';
import { SnapshotsTab } from '@/components/dashboard/snapshots-tab';
import { BackupsTab } from '@/components/dashboard/backups-tab';
import { TabBar } from '@/components/dashboard/tab-bar';
import { FirewallRulesTab } from '@/components/firewall/firewall-rules-tab';
import { FirewallOptionsTab } from '@/components/firewall/firewall-options-tab';
import type { UpdateCTConfigParamsPublic } from '@/types/proxmox';

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

function CloneDialog({ currentName, onConfirm, onCancel, isLoading }: {
  currentName: string; isLoading: boolean;
  onConfirm: (newid: number, hostname: string) => void;
  onCancel: () => void;
}) {
  const [newid, setNewid] = useState('');
  const [hostname, setHostname] = useState(`${currentName}-clone`);
  const { data: nextid } = useQuery({ queryKey: ['nextid'], queryFn: () => api.cluster.nextid() });
  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-sm font-semibold text-white mb-4">Clone Container</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">New CT ID</label>
            <input type="number" placeholder={String(nextid ?? '...')} value={newid} onChange={(e) => setNewid(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50" />
          </div>
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Hostname</label>
            <input type="text" value={hostname} onChange={(e) => setHostname(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50" />
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition">Cancel</button>
          <button onClick={() => onConfirm(Number(newid) || (nextid ?? 0), hostname)} disabled={isLoading}
            className="px-4 py-2 text-sm font-medium bg-zinc-300 hover:bg-zinc-200 text-zinc-900 rounded-lg transition disabled:opacity-50">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CTDetailPage({ params }: { params: Promise<{ node: string; vmid: string }> }) {
  const { node, vmid: vmidStr } = use(params);
  const vmid = parseInt(vmidStr, 10);
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'summary' | 'hardware' | 'snapshots' | 'backups' | 'firewall' | 'metrics'>('summary');
  const [showDelete, setShowDelete] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);
  const [editConfig, setEditConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<UpdateCTConfigParamsPublic>({});

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['ct', node, vmid, 'status'],
    queryFn: () => api.containers.status(node, vmid),
    refetchInterval: 5_000,
  });

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['ct', node, vmid, 'config'],
    queryFn: () => api.containers.config(node, vmid),
  });

  const { data: tasks } = useQuery({
    queryKey: ['ct', node, vmid, 'tasks'],
    queryFn: () => api.nodes.tasks(node),
    select: (data) => data.filter((t) => t.id === String(vmid)).slice(0, 10),
    refetchInterval: 10_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ct', node, vmid, 'status'] });
    qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
  };

  const startM = useMutation({ mutationFn: () => api.containers.start(node, vmid), onSuccess: invalidate });
  const shutdownM = useMutation({ mutationFn: () => api.containers.shutdown(node, vmid), onSuccess: invalidate });
  const stopM = useMutation({ mutationFn: () => api.containers.stop(node, vmid), onSuccess: invalidate });
  const rebootM = useMutation({ mutationFn: () => api.containers.reboot(node, vmid), onSuccess: invalidate });
  const deleteM = useMutation({
    mutationFn: () => api.containers.delete(node, vmid),
    onSuccess: () => {
      // Purge the deleted CT from the cluster-resources cache *before*
      // navigating, so the list view doesn't render a ghost row while the
      // 10s poll catches up.
      qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
      router.push('/dashboard/cts');
    },
  });
  const cloneM = useMutation({
    mutationFn: (p: { newid: number; hostname: string }) =>
      api.containers.clone(node, vmid, { newid: p.newid, hostname: p.hostname }),
    onSuccess: () => { setShowClone(false); qc.invalidateQueries({ queryKey: ['cluster', 'resources'] }); },
  });
  // Migration moved to MigrateWizard (via useMigrateGuest). Navigation
  // to the list view on success is preserved below via onSuccess.
  const saveConfigM = useMutation({
    mutationFn: () => api.containers.updateConfig(node, vmid, configDraft),
    onSuccess: () => {
      setEditConfig(false);
      setConfigDraft({});
      qc.invalidateQueries({ queryKey: ['ct', node, vmid, 'config'] });
    },
  });

  const isRunning = status?.status === 'running';
  const isStopped = status?.status === 'stopped';
  const anyPending = startM.isPending || shutdownM.isPending || stopM.isPending || rebootM.isPending;

  const cpu = cpuPercent(status?.cpu);
  const mem = memPercent(status?.mem, status?.maxmem);
  const disk = memPercent(status?.disk, status?.maxdisk);

  const ctName = status?.name ?? config?.hostname ?? `CT ${vmid}`;

  const netSlots = config
    ? (['net0','net1','net2','net3'] as const).filter((k) => config[k]).map((k) => ({ key: k, value: config[k]! }))
    : [];

  const tabs = [{ id: 'summary', label: 'Summary' }, { id: 'hardware', label: 'Hardware' }, { id: 'snapshots', label: 'Snapshots' }, { id: 'backups', label: 'Backups' }, { id: 'firewall', label: 'Firewall' }, { id: 'metrics', label: 'Metrics' }] as const;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/dashboard/cts" className="flex items-center gap-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition">
          <ChevronLeft className="w-3.5 h-3.5" />
          Containers
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-[var(--color-fg-secondary)]">{ctName}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', isRunning ? 'bg-emerald-500/10' : 'bg-[var(--color-overlay)]')}>
            <Box className={cn('w-5 h-5', isRunning ? 'text-emerald-400' : 'text-[var(--color-fg-subtle)]')} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-white">{ctName}</h1>
              <Badge variant={statusVariant(status?.status)}>{status?.status ?? 'unknown'}</Badge>
            </div>
            <p className="text-sm text-[var(--color-fg-subtle)] mt-0.5">
              CT {vmid} · <span className="inline-flex items-center gap-1"><Server className="w-3 h-3" />{node}</span>
              {config?.ostype && <> · {config.ostype}</>}
            </p>
          </div>
        </div>

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
          <Link href={`/console?node=${node}&vmid=${vmid}&type=lxc`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg transition">
            <Terminal className="w-4 h-4" />
            Console
          </Link>
          <a
            href={`/console/vnc?node=${encodeURIComponent(node)}&vmid=${vmid}&type=lxc`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] text-[var(--color-fg-secondary)] text-sm rounded-lg transition"
            title="Open graphical console in a new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Graphical Console
          </a>
          <button onClick={() => setShowClone(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg transition">
            <Copy className="w-4 h-4" />
            Clone
          </button>
          <button onClick={() => setShowMigrate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg transition">
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

      <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 transition -mb-px',
              tab === t.id ? 'border-zinc-200 text-indigo-400' : 'border-transparent text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="space-y-4">
          {statusLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-fg-muted)]" /></div>
          ) : status ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="studio-card p-4">
                <div className="flex items-center gap-2 mb-3"><Cpu className="w-4 h-4 text-[var(--color-fg-subtle)]" /><span className="text-xs font-medium text-[var(--color-fg-muted)]">CPU</span></div>
                <p className="text-2xl font-semibold text-white tabular-nums">{cpu.toFixed(1)}%</p>
                <ProgressBar value={cpu} className="mt-2" />
                <p className="text-xs text-[var(--color-fg-faint)] mt-1">{status.cpus ?? status.maxcpu ?? '?'} cores</p>
              </div>
              <div className="studio-card p-4">
                <div className="flex items-center gap-2 mb-3"><MemoryStick className="w-4 h-4 text-[var(--color-fg-subtle)]" /><span className="text-xs font-medium text-[var(--color-fg-muted)]">Memory</span></div>
                <p className="text-2xl font-semibold text-white">{formatBytes(status.mem ?? 0)}</p>
                <ProgressBar value={mem} className="mt-2" />
                <p className="text-xs text-[var(--color-fg-faint)] mt-1">of {formatBytes(status.maxmem ?? 0)}</p>
              </div>
              <div className="studio-card p-4">
                <div className="flex items-center gap-2 mb-3"><HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)]" /><span className="text-xs font-medium text-[var(--color-fg-muted)]">Disk</span></div>
                <p className="text-2xl font-semibold text-white">{formatBytes(status.disk ?? 0)}</p>
                <ProgressBar value={disk} className="mt-2" />
                <p className="text-xs text-[var(--color-fg-faint)] mt-1">of {formatBytes(status.maxdisk ?? 0)}</p>
              </div>
              <div className="studio-card p-4">
                <div className="flex items-center gap-2 mb-3"><Network className="w-4 h-4 text-[var(--color-fg-subtle)]" /><span className="text-xs font-medium text-[var(--color-fg-muted)]">Network I/O</span></div>
                <p className="text-sm font-medium text-white">↑ {formatBytes(status.netout ?? 0)}</p>
                <p className="text-sm font-medium text-white mt-1">↓ {formatBytes(status.netin ?? 0)}</p>
                {status.uptime != null && <p className="text-xs text-[var(--color-fg-faint)] mt-2">Up {formatUptime(status.uptime)}</p>}
              </div>
            </div>
          ) : null}

          {tasks && tasks.length > 0 && (
            <div className="studio-card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <h3 className="text-sm font-medium text-[var(--color-fg-secondary)]">Recent Tasks</h3>
              </div>
              <table className="w-full">
                <tbody className="divide-y divide-zinc-800/60/60">
                  {tasks.map((t) => (
                    <tr key={t.upid}>
                      <td className="px-4 py-2.5 text-xs font-mono text-[var(--color-fg-muted)]">{t.type}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-fg-subtle)]">{new Date(t.starttime * 1000).toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={t.exitstatus === 'OK' ? 'success' : t.exitstatus ? 'danger' : 'info'}>{t.exitstatus ?? 'running'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'hardware' && (
        <div className="space-y-4">
          {configLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-fg-muted)]" /></div>
          ) : config ? (
            <>
              <div className="studio-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white">General</h3>
                  {!editConfig ? (
                    <button onClick={() => { setConfigDraft({ hostname: config.hostname, cores: config.cores, memory: config.memory, swap: config.swap, onboot: config.onboot, description: config.description }); setEditConfig(true); }}
                      className="text-xs px-3 py-1 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] rounded-lg transition">Edit</button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => { setEditConfig(false); setConfigDraft({}); }} className="text-xs px-3 py-1 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-muted)] rounded-lg transition">Cancel</button>
                      <button onClick={() => saveConfigM.mutate()} disabled={saveConfigM.isPending}
                        className="flex items-center gap-1.5 text-xs px-3 py-1 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 rounded-lg transition disabled:opacity-50">
                        {saveConfigM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {(['hostname', 'cores', 'memory', 'swap', 'onboot', 'description'] as const).map((field) => (
                    <div key={field}>
                      <label className="text-xs text-[var(--color-fg-subtle)] capitalize block mb-1">
                        {field === 'onboot' ? 'Start at Boot' : field === 'memory' ? 'Memory (MB)' : field === 'swap' ? 'Swap (MB)' : field}
                      </label>
                      {editConfig ? (
                        field === 'onboot' ? (
                          <input type="checkbox" checked={!!configDraft.onboot}
                            onChange={(e) => setConfigDraft((d) => ({ ...d, onboot: e.target.checked }))}
                            className="rounded border-gray-600" />
                        ) : (
                          <input
                            type={['cores','memory','swap'].includes(field) ? 'number' : 'text'}
                            value={String(configDraft[field as keyof UpdateCTConfigParamsPublic] ?? '')}
                            onChange={(e) => setConfigDraft((d) => ({
                              ...d,
                              [field]: ['cores','memory','swap'].includes(field) ? Number(e.target.value) : e.target.value,
                            }))}
                            className="w-full px-2.5 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
                          />
                        )
                      ) : (
                        <p className="text-sm text-[var(--color-fg-secondary)]">
                          {field === 'onboot' ? (config.onboot ? 'Yes' : 'No') : String(config[field as keyof typeof config] ?? '—')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {config.rootfs && (
                <div className="studio-card p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">Root Filesystem</h3>
                  <div className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg">
                    <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-mono text-[var(--color-fg-muted)] mb-0.5">rootfs</p>
                      <p className="text-sm text-[var(--color-fg-secondary)]">{config.rootfs.split(',')[0]}</p>
                      {(() => { const kv = parseKV(config.rootfs); return kv.size ? <p className="text-xs text-[var(--color-fg-subtle)]">Size: {kv.size}</p> : null; })()}
                    </div>
                  </div>
                </div>
              )}

              {netSlots.length > 0 && (
                <div className="studio-card p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">Network</h3>
                  <div className="space-y-2">
                    {netSlots.map(({ key, value }) => {
                      const kv = parseKV(value);
                      return (
                        <div key={key} className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg">
                          <Network className="w-4 h-4 text-[var(--color-fg-subtle)] mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-mono text-[var(--color-fg-muted)] mb-0.5">{key}</p>
                            <p className="text-sm text-[var(--color-fg-secondary)]">{kv.bridge ?? '—'}</p>
                            <p className="text-xs text-[var(--color-fg-subtle)]">{kv.ip ?? kv.ip6 ?? 'dhcp'}</p>
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

      {tab === 'snapshots' && (
        <SnapshotsTab kind="lxc" node={node} vmid={vmid} />
      )}

      {tab === 'backups' && (
        <BackupsTab kind="lxc" node={node} vmid={vmid} />
      )}

      {tab === 'firewall' && (
        <CTFirewallSubtabs node={node} vmid={vmid} kind="ct" />
      )}

      {tab === 'metrics' && (
        <VMMetricsChart node={node} vmid={vmid} type="lxc" />
      )}

      {showDelete && (
        <ConfirmDialog title="Delete Container" danger
          message={`Permanently delete "${ctName}" (${vmid}) and all its data? This cannot be undone.`}
          onConfirm={() => deleteM.mutate()} onCancel={() => setShowDelete(false)} />
      )}
      {showClone && (
        <CloneDialog currentName={ctName} isLoading={cloneM.isPending}
          onConfirm={(newid, hostname) => cloneM.mutate({ newid, hostname })}
          onCancel={() => setShowClone(false)} />
      )}
      {showMigrate && (
        <MigrateWizard
          guestType="lxc"
          sourceNode={node}
          vmid={vmid}
          vmName={ctName}
          isRunning={isRunning}
          cores={config?.cores ?? 1}
          memoryBytes={(config?.memory ?? 512) * 1024 * 1024}
          onClose={() => setShowMigrate(false)}
          onSuccess={() => router.push('/dashboard/cts')}
        />
      )}
    </div>
  );
}

// ── Firewall subtabs ──────────────────────────────────────────────────────────

function CTFirewallSubtabs({ node, vmid, kind }: { node: string; vmid: number; kind: 'vm' | 'ct' }) {
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

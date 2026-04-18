'use client';

/**
 * /dashboard/health — Global Health (NOC) view.
 *
 * Five panels, one screen:
 *   1. Summary row — nodes online, running guests, avg CPU%, avg mem%
 *   2. Top offenders — hottest VMs/CTs by CPU + by memory (two columns)
 *   3. Storage exhaustion — sorted by projected daysUntilFull asc
 *   4. Recent failures — click opens the correlation drawer
 *
 * All visual thresholds (≤65 emerald / 66-85 amber / >85 red) match the
 * existing ProgressBar/Gauge language so the page reads the same way
 * as the rest of the dashboard.
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  HeartPulse,
  Loader2,
  MemoryStick,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatCard } from '@/components/ui/stat-card';
import { TaskCorrelationDrawer } from '@/components/tasks/task-correlation-drawer';
import { useClusterHealth, type StorageHealthRow } from '@/hooks/use-cluster-health';
import type { TopGuest } from '@/lib/cluster-pressure';
import type { PVETask } from '@/types/proxmox';

// ─── Helpers (outside component — keeps Date.now() off the render body) ─────

function exhaustionBadge(row: StorageHealthRow): { variant: 'danger' | 'warning' | 'info' | 'outline'; label: string } {
  if (row.daysUntilFull === null) return { variant: 'outline', label: 'no trend' };
  if (row.daysUntilFull === 0) return { variant: 'danger', label: 'overdue' };
  if (row.daysUntilFull < 30) return { variant: 'danger', label: `${Math.ceil(row.daysUntilFull)}d` };
  if (row.daysUntilFull < 90) return { variant: 'warning', label: `${Math.ceil(row.daysUntilFull)}d` };
  return { variant: 'info', label: `${Math.ceil(row.daysUntilFull)}d` };
}

function guestHref(g: TopGuest): string {
  if (g.type === 'qemu') return `/dashboard/vms/${g.node}/${g.vmid}`;
  return `/dashboard/cts/${g.node}/${g.vmid}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HealthPage() {
  const { pressure, storage, loading, error } = useClusterHealth();
  const [drawerTask, setDrawerTask] = useState<PVETask | null>(null);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HeartPulse className="w-6 h-6 text-indigo-300" />
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-fg)]">Cluster Health</h1>
            <p className="text-sm text-[var(--color-fg-subtle)]">Live pressure signals and recent failures.</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 text-[var(--color-err)] mt-0.5 shrink-0" />
          <span className="text-[var(--color-err)]">{error.message}</span>
        </div>
      )}

      {loading && !pressure && (
        <div className="flex items-center justify-center h-48 text-[var(--color-fg-muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Gathering pressure signals…
        </div>
      )}

      {pressure && (
        <>
          {/* 1. Summary row */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard
              label="Nodes online"
              value={`${pressure.nodesOnline}/${pressure.nodesTotal}`}
              icon={<Activity className="w-4 h-4" />}
              sub={pressure.nodesOnline < pressure.nodesTotal ? 'Some nodes offline' : 'All nodes up'}
            />
            <StatCard
              label="Running guests"
              value={`${pressure.runningGuests}/${pressure.totalGuests}`}
              icon={<RefreshCw className="w-4 h-4" />}
            />
            <StatCard
              label="Avg CPU"
              value={`${Math.round(pressure.avgCpu * 100)}%`}
              percent={pressure.avgCpu * 100}
              icon={<Cpu className="w-4 h-4" />}
            />
            <StatCard
              label="Avg memory"
              value={`${Math.round(pressure.avgMemory * 100)}%`}
              percent={pressure.avgMemory * 100}
              icon={<MemoryStick className="w-4 h-4" />}
            />
          </div>

          {pressure.peakLoadavgPerCore !== undefined && (
            <p className="text-xs text-[var(--color-fg-subtle)]">
              Peak load-per-core across online nodes:{' '}
              <span
                className={cn(
                  'font-mono tabular',
                  pressure.peakLoadavgPerCore > 1
                    ? 'text-[var(--color-err)]'
                    : pressure.peakLoadavgPerCore > 0.75
                      ? 'text-[var(--color-warn)]'
                      : 'text-[var(--color-fg-secondary)]',
                )}
              >
                {pressure.peakLoadavgPerCore.toFixed(2)}
              </span>
            </p>
          )}

          {/* 2. Top offenders */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <OffenderPanel
              title="Hottest VMs / CTs (CPU)"
              emptyMsg="No running guests with CPU signal."
              guests={pressure.topGuestsByCpu}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
            <OffenderPanel
              title="Heaviest VMs / CTs (Memory)"
              emptyMsg="No running guests with memory signal."
              guests={pressure.topGuestsByMemory}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
          </div>

          {/* 3. Storage exhaustion */}
          <StorageExhaustionPanel storage={storage} />

          {/* 4. Recent failures */}
          <RecentFailuresPanel
            failures={pressure.recentFailures}
            onTaskClick={(t) => setDrawerTask(t)}
          />
        </>
      )}

      <TaskCorrelationDrawer task={drawerTask} onClose={() => setDrawerTask(null)} />
    </div>
  );
}

// ─── Offender panel ──────────────────────────────────────────────────────────

function OffenderPanel({
  title,
  emptyMsg,
  guests,
  formatValue,
}: {
  title: string;
  emptyMsg: string;
  guests: TopGuest[];
  formatValue: (v: number) => string;
}) {
  return (
    <section className="studio-card rounded-lg p-4">
      <p className="text-[11px] font-semibold text-[var(--color-fg-subtle)] uppercase tracking-widest mb-3">{title}</p>
      {guests.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-faint)] py-4 text-center">{emptyMsg}</p>
      ) : (
        <ul className="space-y-2">
          {guests.map((g) => (
            <li key={g.id}>
              <Link
                href={guestHref(g)}
                className="flex items-center gap-3 hover:bg-zinc-800/40 rounded-md px-2 py-1.5 -mx-2 transition"
              >
                <Badge variant={g.type === 'qemu' ? 'warning' : 'info'}>
                  {g.type === 'qemu' ? 'VM' : 'CT'}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--color-fg)] truncate">{g.name ?? g.id}</span>
                    {g.vmid && <span className="text-xs text-[var(--color-fg-subtle)] font-mono">({g.vmid})</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <ProgressBar value={Math.round(g.value * 100)} className="flex-1" />
                    <span className="text-xs text-[var(--color-fg-muted)] tabular font-mono shrink-0 w-10 text-right">
                      {formatValue(g.value)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-fg-faint)] mt-0.5 font-mono truncate">{g.node}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Storage exhaustion panel ────────────────────────────────────────────────

function StorageExhaustionPanel({ storage }: { storage: StorageHealthRow[] }) {
  const rows = [...storage].sort((a, b) => {
    // Exhaustion-first: null (no trend) sinks to bottom, then ascending days.
    if (a.daysUntilFull === null && b.daysUntilFull === null) return b.usedFraction - a.usedFraction;
    if (a.daysUntilFull === null) return 1;
    if (b.daysUntilFull === null) return -1;
    return a.daysUntilFull - b.daysUntilFull;
  }).slice(0, 10);

  return (
    <section className="studio-card rounded-lg p-4">
      <p className="text-[11px] font-semibold text-[var(--color-fg-subtle)] uppercase tracking-widest mb-3">
        Storage exhaustion
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-faint)] py-4 text-center">No storage pools reporting capacity.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-[var(--color-fg-subtle)]">
              <tr>
                <th className="text-left font-medium py-1.5">Storage</th>
                <th className="text-left font-medium py-1.5">Node</th>
                <th className="text-left font-medium py-1.5 w-48">Usage</th>
                <th className="text-right font-medium py-1.5">Capacity</th>
                <th className="text-right font-medium py-1.5">Until full</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = exhaustionBadge(row);
                return (
                  <tr key={`${row.node}:${row.storage}`} className="border-t border-zinc-800/40">
                    <td className="py-2 font-mono text-[var(--color-fg-secondary)]">{row.storage}</td>
                    <td className="py-2 font-mono text-[var(--color-fg-subtle)]">{row.node}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={Math.round(row.usedFraction * 100)} className="flex-1" />
                        <span className="text-xs text-[var(--color-fg-muted)] tabular font-mono w-10 text-right">
                          {Math.round(row.usedFraction * 100)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right text-xs text-[var(--color-fg-muted)] tabular">
                      {formatBytes(row.used)} / {formatBytes(row.total)}
                    </td>
                    <td className="py-2 text-right">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Recent failures panel ───────────────────────────────────────────────────

function RecentFailuresPanel({
  failures,
  onTaskClick,
}: {
  failures: ReturnType<typeof useClusterHealth>['pressure'] extends infer P
    ? P extends { recentFailures: infer F }
      ? F
      : never
    : never;
  onTaskClick: (t: PVETask) => void;
}) {
  return (
    <section className="studio-card rounded-lg p-4">
      <p className="text-[11px] font-semibold text-[var(--color-fg-subtle)] uppercase tracking-widest mb-3">
        Recent failures
      </p>
      {failures.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-faint)] py-4 text-center flex items-center justify-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-ok)]" /> No recent task failures.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/40">
          {failures.map((f) => (
            <li key={f.upid}>
              <button
                type="button"
                onClick={() =>
                  onTaskClick({
                    upid: f.upid,
                    node: f.node,
                    type: f.type,
                    id: f.id,
                    user: f.user,
                    starttime: f.starttime,
                    endtime: f.endtime,
                    exitstatus: f.exitstatus,
                  })
                }
                className="w-full text-left flex items-center gap-3 py-2 px-2 -mx-2 hover:bg-zinc-800/40 rounded-md transition"
              >
                <XCircle className="w-4 h-4 text-[var(--color-err)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-[var(--color-fg)]">{f.type}</span>
                    {f.id && <span className="text-xs text-[var(--color-fg-subtle)] font-mono">{f.id}</span>}
                    <Badge variant="danger">{f.exitstatus}</Badge>
                  </div>
                  <p className="text-xs text-[var(--color-fg-subtle)] mt-0.5 font-mono truncate">
                    {f.node} · {f.user} · {new Date(f.starttime * 1000).toLocaleString()}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

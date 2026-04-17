'use client';

import { useQuery } from '@tanstack/react-query';
import { useNodes } from '@/hooks/use-cluster';
import { api } from '@/lib/proxmox-client';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Activity,
  Pause,
  Play,
} from 'lucide-react';
import { useState } from 'react';
import type { PVETask } from '@/types/proxmox';
import { hintForTask } from '@/lib/task-hints';
import { Lightbulb } from 'lucide-react';
import { TaskCorrelationDrawer } from '@/components/tasks/task-correlation-drawer';

function statusVariant(task: PVETask): 'success' | 'danger' | 'warning' | 'info' | 'outline' {
  const s = task.exitstatus ?? task.status ?? '';
  if (s === 'OK') return 'success';
  if (s === 'running' || s === '') return 'info';
  if (s.startsWith('WARNINGS')) return 'warning';
  if (s) return 'danger';
  return 'outline';
}

function TaskStatusIcon({ task }: { task: PVETask }) {
  const s = task.exitstatus ?? task.status ?? '';
  if (s === 'OK') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (s === 'running' || s === '') return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
  if (s.startsWith('WARNINGS')) return <CheckCircle2 className="w-4 h-4 text-yellow-400" />;
  if (s) return <XCircle className="w-4 h-4 text-red-400" />;
  return <Clock className="w-4 h-4 text-[var(--color-fg-faint)]" />;
}

function formatDuration(start: number, end?: number): string {
  const s = (end ?? Math.floor(Date.now() / 1000)) - start;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export default function TasksPage() {
  const { data: nodes } = useNodes();
  const [nodeFilter, setNodeFilter] = useState('all');
  const [paused, setPaused] = useState(false);
  const [drawerTask, setDrawerTask] = useState<PVETask | null>(null);

  const nodeNames = nodes?.map((n) => n.node ?? n.id) ?? [];

  const { data: tasks, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['tasks', 'all', nodeNames],
    queryFn: async () => {
      const results = await Promise.all(
        nodeNames.map(async (node) => {
          const t = await api.nodes.tasks(node);
          return t.map((task) => ({ ...task, node }));
        }),
      );
      return results.flat().sort((a, b) => b.starttime - a.starttime);
    },
    enabled: nodeNames.length > 0,
    refetchInterval: paused ? false : 10_000,
  });

  const filtered =
    nodeFilter === 'all' ? (tasks ?? []) : (tasks ?? []).filter((t) => t.node === nodeFilter);

  const running = filtered.filter((t) => !t.exitstatus && !t.endtime).length;
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Tasks</h1>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            {running > 0 ? `${running} running · ` : ''}
            {filtered.length} total · Updated {lastUpdated}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-xs text-[var(--color-fg-muted)] transition"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-xs text-[var(--color-fg-muted)] transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Node filter */}
      {nodeNames.length > 1 && (
        <div className="flex gap-1.5">
          {['all', ...nodeNames].map((n) => (
            <button
              key={n}
              onClick={() => setNodeFilter(n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                nodeFilter === n
                  ? 'bg-white/10 text-indigo-400 border border-zinc-300/30'
                  : 'text-[var(--color-fg-subtle)] bg-[var(--color-surface)] border border-[var(--color-border-subtle)] hover:text-[var(--color-fg-secondary)]'
              }`}
            >
              {n === 'all' ? 'All nodes' : n}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-fg-muted)]" />
        </div>
      )}

      <TaskCorrelationDrawer task={drawerTask} onClose={() => setDrawerTask(null)} />

      {!isLoading && (
        <div className="studio-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--color-fg-subtle)]" />
            <span className="text-sm font-medium text-[var(--color-fg-secondary)]">Task Log</span>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-faint)] py-10 text-center">No tasks found</p>
          ) : (
            <div className="divide-y divide-zinc-800/60/50">
              {filtered.map((task) => (
                <button
                  key={task.upid}
                  type="button"
                  onClick={() => setDrawerTask(task)}
                  className="w-full text-left flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/40 transition cursor-pointer focus:outline-none focus:bg-zinc-800/60"
                >
                  <TaskStatusIcon task={task} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-white font-medium">{task.type}</span>
                      {task.id && (
                        <span className="text-xs text-[var(--color-fg-subtle)] font-mono">{task.id}</span>
                      )}
                      <Badge variant={statusVariant(task)}>
                        {task.exitstatus ?? task.status ?? (task.endtime ? 'unknown' : 'running')}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--color-fg-subtle)] mt-0.5 truncate">
                      {task.node} · {task.user}
                    </p>
                    {(() => {
                      const hint = hintForTask(task);
                      if (!hint) return null;
                      return (
                        <p className="flex items-start gap-1.5 text-xs text-yellow-300/90 mt-1">
                          <Lightbulb className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>{hint.message}</span>
                        </p>
                      );
                    })()}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs text-[var(--color-fg-muted)]">
                      {new Date(task.starttime * 1000).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    <p className="text-xs text-[var(--color-fg-faint)] mt-0.5">
                      {formatDuration(task.starttime, task.endtime)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

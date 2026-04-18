'use client';

import { useClusterTasks } from '@/hooks/use-cluster';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

function TaskStatusIcon({ status }: { status?: string }) {
  if (status === 'OK') return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-ok)]" />;
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
  if (status?.startsWith('WARNINGS')) return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-warn)]" />;
  if (status) return <XCircle className="w-3.5 h-3.5 text-[var(--color-err)]" />;
  return <Clock className="w-3.5 h-3.5 text-[var(--color-fg-faint)]" />;
}

export function TaskList() {
  const { data: tasks, isLoading } = useClusterTasks();

  const recent = tasks?.slice(0, 8) ?? [];

  return (
    <div className="studio-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Recent Tasks</h3>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>

      {recent.length === 0 && !isLoading && (
        <p className="text-sm text-[var(--color-fg-faint)] py-4 text-center">No recent tasks</p>
      )}

      <div className="space-y-1">
        {recent.map((task) => (
          <div
            key={task.upid}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-overlay)] transition group"
          >
            <TaskStatusIcon status={task.exitstatus ?? task.status} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--color-fg-secondary)] truncate">
                {task.type}
                {task.id && <span className="text-[var(--color-fg-subtle)] ml-1">({task.id})</span>}
              </p>
              <p className="text-xs text-[var(--color-fg-faint)]">{task.node} · {task.user}</p>
            </div>
            <time className="text-xs text-[var(--color-fg-faint)] shrink-0">
              {new Date(task.starttime * 1000).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
        ))}
      </div>
    </div>
  );
}

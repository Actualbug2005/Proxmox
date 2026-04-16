'use client';

import { useClusterTasks } from '@/hooks/use-cluster';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

function TaskStatusIcon({ status }: { status?: string }) {
  if (status === 'OK') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
  if (status?.startsWith('WARNINGS')) return <CheckCircle2 className="w-3.5 h-3.5 text-yellow-400" />;
  if (status) return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  return <Clock className="w-3.5 h-3.5 text-zinc-600" />;
}

export function TaskList() {
  const { data: tasks, isLoading } = useClusterTasks();

  const recent = tasks?.slice(0, 8) ?? [];

  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Recent Tasks</h3>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {recent.length === 0 && !isLoading && (
        <p className="text-sm text-zinc-600 py-4 text-center">No recent tasks</p>
      )}

      <div className="space-y-1">
        {recent.map((task) => (
          <div
            key={task.upid}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800 transition group"
          >
            <TaskStatusIcon status={task.exitstatus ?? task.status} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-300 truncate">
                {task.type}
                {task.id && <span className="text-zinc-500 ml-1">({task.id})</span>}
              </p>
              <p className="text-xs text-zinc-600">{task.node} · {task.user}</p>
            </div>
            <time className="text-xs text-zinc-600 shrink-0">
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

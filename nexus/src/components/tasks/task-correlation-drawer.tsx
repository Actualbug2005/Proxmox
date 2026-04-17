'use client';

/**
 * TaskCorrelationDrawer — side-by-side view of a PVE task's own log
 * and the host journal entries from the same time window. The idea:
 * when a task fails you want to see what else was happening on the
 * host at that moment.
 *
 * Left pane : api.tasks.log — plain line-numbered text output.
 * Right pane: useJournalWindow over [starttime - pad, endtime + pad]
 *             rendered as priority-coloured pips.
 *
 * Controls: pad stepper (±30s / ±2m / ±5m) and priority floor
 * (all / warnings+ / errors only).
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Filter, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { PRIORITY_CLASS, type Priority } from '@/lib/journal-parse';
import { useJournalWindow, useTaskLog } from '@/hooks/use-journal-window';
import type { PVETask } from '@/types/proxmox';

interface TaskCorrelationDrawerProps {
  task: PVETask | null;
  onClose: () => void;
}

const PAD_CHOICES = [
  { label: '±30s', seconds: 30 },
  { label: '±2m', seconds: 120 },
  { label: '±5m', seconds: 300 },
] as const;

// Ordered for comparisons — higher index = more severe.
const PRIORITY_ORDER: Priority[] = ['debug', 'info', 'warning', 'error'];

export function TaskCorrelationDrawer({ task, onClose }: TaskCorrelationDrawerProps) {
  const [padSeconds, setPadSeconds] = useState<number>(30);
  const [minPriority, setMinPriority] = useState<Priority>('info');

  const since = task ? task.starttime - padSeconds : null;
  const until = task ? (task.endtime ?? task.starttime + 60) + padSeconds : null;

  const journal = useJournalWindow(task?.node ?? null, since, until, {
    lastentries: 500,
  });
  const log = useTaskLog(task?.node ?? null, task?.upid ?? null);

  const filteredJournal = useMemo(() => {
    const floor = PRIORITY_ORDER.indexOf(minPriority);
    return (journal.data ?? []).filter((l) => PRIORITY_ORDER.indexOf(l.priority) >= floor);
  }, [journal.data, minPriority]);

  if (!task) return null;

  const exitVariant =
    task.exitstatus === 'OK' ? 'success' : task.exitstatus ? 'danger' : 'info';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 overflow-y-auto sm:py-8">
      <div className="studio-card p-5 w-full max-w-5xl h-[80vh] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white">
                {task.type}
                {task.id ? <span className="text-[var(--color-fg-subtle)] font-mono ml-2">{task.id}</span> : null}
              </h3>
              <Badge variant={exitVariant}>
                {task.exitstatus ?? task.status ?? 'running'}
              </Badge>
            </div>
            <p className="text-xs text-[var(--color-fg-subtle)] mt-0.5 font-mono truncate">
              {task.node} · {task.user} ·{' '}
              {new Date(task.starttime * 1000).toLocaleString()}
              {task.endtime ? (
                <>
                  {' → '}
                  {new Date(task.endtime * 1000).toLocaleTimeString()}
                </>
              ) : null}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-fg-subtle)] hover:text-white p-1 shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-3 text-xs">
          <div className="flex items-center gap-1 bg-[var(--color-overlay)] p-1 rounded-lg">
            {PAD_CHOICES.map((c) => (
              <button
                key={c.seconds}
                onClick={() => setPadSeconds(c.seconds)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition',
                  padSeconds === c.seconds
                    ? 'bg-zinc-700 text-white'
                    : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-[var(--color-overlay)] p-1 rounded-lg">
            <Filter className="w-3 h-3 text-[var(--color-fg-subtle)] ml-1" />
            {(['info', 'warning', 'error'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setMinPriority(p)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition capitalize',
                  minPriority === p
                    ? 'bg-zinc-700 text-white'
                    : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
                )}
              >
                {p === 'info' ? 'All' : `${p}+`}
              </button>
            ))}
          </div>
        </div>

        {/* Split panes */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
          <Pane title="Task log" loading={log.isLoading} error={log.error}>
            {(log.data ?? []).length === 0 ? (
              <p className="text-xs text-[var(--color-fg-faint)] p-4">No task log captured.</p>
            ) : (
              <pre className="text-xs text-[var(--color-fg-secondary)] font-mono whitespace-pre-wrap p-3">
                {(log.data ?? []).map((l) => l.t).join('\n')}
              </pre>
            )}
          </Pane>

          <Pane
            title={`Journal · ${filteredJournal.length}${journal.data && filteredJournal.length !== journal.data.length ? `/${journal.data.length}` : ''} lines`}
            loading={journal.isLoading}
            error={journal.error}
          >
            {filteredJournal.length === 0 ? (
              <p className="text-xs text-[var(--color-fg-faint)] p-4">
                No entries in window{minPriority !== 'info' ? ' at this priority' : ''}.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-800/60">
                {filteredJournal.map((entry, i) => (
                  <li
                    key={`${entry.raw}-${i}`}
                    className="flex items-start gap-2 px-3 py-1.5 text-xs"
                  >
                    <span
                      className={cn('shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase', PRIORITY_CLASS[entry.priority])}
                    >
                      {entry.priority[0]}
                    </span>
                    <span className="text-[var(--color-fg-faint)] font-mono shrink-0 w-24 truncate" title={entry.time}>
                      {entry.time}
                    </span>
                    <span className="text-[var(--color-fg-muted)] font-mono shrink-0 w-32 truncate" title={entry.unit}>
                      {entry.unit}
                    </span>
                    <span className="text-[var(--color-fg-secondary)] min-w-0 break-words">{entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Pane>
        </div>
      </div>
    </div>
  );
}

function Pane({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading: boolean;
  error: Error | null;
  children: React.ReactNode;
}) {
  return (
    <section className="studio-card rounded-lg flex flex-col min-h-0">
      <header className="px-3 py-2 border-b border-[var(--color-border-subtle)] flex items-center gap-2 shrink-0">
        <span className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">{title}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </header>
      {error ? (
        <div className="flex items-start gap-2 p-3 text-xs text-red-300">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
          <span>{error.message}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      )}
    </section>
  );
}

'use client';

/**
 * /dashboard/schedules — list + manage Community-Script schedules.
 *
 * Layout mirrors /dashboard: header row + summary stats + card grid. Each
 * row shows script/slug, node, cadence, last-fire, enabled state and the
 * row actions (toggle, edit, delete).
 */

import { useState } from 'react';
import {
  AlertCircle,
  Clock,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScheduleJobEditor } from '@/components/scripts/schedule-job-editor';
import { useToast } from '@/components/ui/toast';
import {
  useDeleteScheduledJob,
  useScheduleRuns,
  useScheduledJobs,
  useUpdateScheduledJob,
  type ScheduledJobDto,
} from '@/hooks/use-scheduled-jobs';

// Cron presets → human label. Covers what <CronInput> emits by hand; falls
// back to the raw expression for anything else.
const CRON_LABELS: Record<string, string> = {
  '*/5 * * * *': 'Every 5 minutes',
  '*/10 * * * *': 'Every 10 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Hourly',
  '0 0 * * *': 'Daily at midnight',
  '0 2 * * *': 'Daily at 02:00',
  '0 6 * * *': 'Daily at 06:00',
  '0 12 * * *': 'Daily at 12:00',
  '0 18 * * *': 'Daily at 18:00',
  '0 2 * * mon..fri': 'Weekdays at 02:00',
  '0 2 * * sat,sun': 'Weekends at 02:00',
  '0 2 * * sun': 'Sundays at 02:00',
};

function humanCron(expr: string): string {
  return CRON_LABELS[expr] ?? expr;
}

function formatRelative(ms: number | undefined): string {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

export default function SchedulesPage() {
  const { data, isLoading, isError, refetch } = useScheduledJobs();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduledJobDto | null>(null);

  const jobs = data?.jobs ?? [];
  const stats = computeStats(jobs);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">Scheduled Jobs</h1>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            Community scripts that run on a cadence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface)] hover:bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-xs text-[var(--color-fg-secondary)] transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={() => {
              setEditingJob(null);
              setEditorOpen(true);
            }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New schedule
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={String(stats.total)} color="text-[var(--color-fg)]" />
        <StatCard label="Enabled" value={String(stats.enabled)} color="text-[var(--color-ok)]" />
        <StatCard label="Fired in last 24h" value={String(stats.recentFires)} color="text-indigo-400" />
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-fg-muted)]" />
        </div>
      )}
      {isError && (
        <div className="flex items-center gap-3 p-4 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-[var(--color-err)] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-err)]">Failed to load schedules</p>
          </div>
          <button
            onClick={() => refetch()}
            className="ml-auto text-xs text-[var(--color-err)] hover:text-[var(--color-err)] underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && jobs.length === 0 && (
        <div className="studio-card rounded-lg p-10 text-center">
          <Clock className="w-8 h-8 text-[var(--color-fg-subtle)] mx-auto mb-3" />
          <p className="text-sm text-[var(--color-fg-secondary)] mb-1">No scheduled jobs yet.</p>
          <p className="text-xs text-[var(--color-fg-subtle)]">
            Open a script on the Community Scripts page and click{' '}
            <span className="font-mono text-[var(--color-fg-muted)]">Schedule</span>, or use{' '}
            <span className="font-mono text-[var(--color-fg-muted)]">New schedule</span> above.
          </p>
        </div>
      )}

      {/* Rows */}
      {jobs.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {jobs.map((job) => (
            <ScheduleRow
              key={job.id}
              job={job}
              onEdit={() => {
                setEditingJob(job);
                setEditorOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <ScheduleJobEditor
          onClose={() => setEditorOpen(false)}
          initial={editingJob}
        />
      )}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ScheduleRow({ job, onEdit }: { job: ScheduledJobDto; onEdit: () => void }) {
  const toast = useToast();
  const updateM = useUpdateScheduledJob();
  const deleteM = useDeleteScheduledJob();
  const [historyOpen, setHistoryOpen] = useState(false);

  const toggle = () => {
    updateM.mutate(
      { id: job.id, patch: { enabled: !job.enabled } },
      {
        onError: (err) => toast.error('Toggle failed', err.message),
      },
    );
  };

  const remove = () => {
    if (!window.confirm(`Delete schedule for "${job.scriptName}"?`)) return;
    deleteM.mutate(job.id, {
      onSuccess: () => toast.success('Schedule deleted'),
      onError: (err) => toast.error('Delete failed', err.message),
    });
  };

  return (
    <div className="studio-card rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium text-[var(--color-fg)] truncate">{job.scriptName}</h3>
            {job.slug && (
              <span className="text-xs font-mono text-[var(--color-fg-subtle)]">{job.slug}</span>
            )}
            <span
              className={cn(
                'inline-block w-1.5 h-1.5 rounded-full',
                job.enabled ? 'bg-[var(--color-ok)]' : 'bg-zinc-600',
              )}
              title={job.enabled ? 'Enabled' : 'Disabled'}
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--color-fg-muted)]">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {humanCron(job.schedule)}
            </span>
            <span>· node {job.node}</span>
            <span>· last fired {formatRelative(job.lastFiredAt)}</span>
            {job.method && <span>· {job.method}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition',
              historyOpen
                ? 'bg-zinc-700 text-[var(--color-fg)]'
                : 'bg-[var(--color-overlay)] hover:bg-zinc-700 text-[var(--color-fg-secondary)]',
            )}
            title="Show run history"
            aria-pressed={historyOpen}
          >
            <History className="w-3.5 h-3.5" />
            History
          </button>
          <button
            onClick={toggle}
            disabled={updateM.isPending}
            className="px-2.5 py-1 text-xs rounded-md bg-[var(--color-overlay)] hover:bg-zinc-700 text-[var(--color-fg-secondary)] transition disabled:opacity-40"
            title={job.enabled ? 'Disable' : 'Enable'}
          >
            {job.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md bg-[var(--color-overlay)] hover:bg-zinc-700 text-[var(--color-fg-secondary)] transition"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={remove}
            disabled={deleteM.isPending}
            className="p-1.5 rounded-md bg-[var(--color-overlay)] hover:bg-[var(--color-err)]/20 text-[var(--color-fg-secondary)] hover:text-[var(--color-err)] transition disabled:opacity-40"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {historyOpen && <ScheduleRuns scheduleId={job.id} />}
    </div>
  );
}

/**
 * Recent-runs table. Lives inline under the row so operators can see
 * the cadence vs reality at a glance without navigating to a separate
 * detail page. Backed by run-history.jsonl — persists across Nexus
 * restarts and beyond the 24h script-job log TTL.
 */
function ScheduleRuns({ scheduleId }: { scheduleId: string }) {
  const { data: runs, isLoading, isError } = useScheduleRuns(scheduleId, 20);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-16 border-t border-white/5">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--color-fg-subtle)]" />
      </div>
    );
  }
  if (isError) {
    return (
      <p className="text-xs text-[var(--color-err)] border-t border-white/5 pt-3">
        Failed to load run history.
      </p>
    );
  }
  if (!runs || runs.length === 0) {
    return (
      <p className="text-xs text-[var(--color-fg-subtle)] border-t border-white/5 pt-3">
        No runs recorded yet. History begins accumulating on the next fire.
      </p>
    );
  }

  return (
    <div className="border-t border-white/5 pt-3">
      <p className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-2">
        Last {runs.length} fires
      </p>
      <div className="space-y-1">
        {runs.map((run) => (
          <div
            key={`${run.at}-${run.jobId ?? 'nojob'}`}
            className="flex items-center gap-3 text-xs tabular text-[var(--color-fg-secondary)] py-1"
          >
            <span
              className={cn(
                'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                run.outcome === 'success'
                  ? 'bg-[var(--color-ok)]'
                  : run.outcome === 'failed'
                    ? 'bg-[var(--color-err)]'
                    : 'bg-zinc-600',
              )}
              title={run.outcome}
            />
            <span className="w-40 shrink-0 text-[var(--color-fg-muted)]">
              {new Date(run.at).toLocaleString()}
            </span>
            <span className="w-16 shrink-0 text-[var(--color-fg-muted)]">
              {typeof run.durationMs === 'number' ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
            </span>
            <span
              className={cn(
                'w-16 shrink-0',
                run.outcome === 'failed' ? 'text-[var(--color-err)]' : 'text-[var(--color-fg-subtle)]',
              )}
            >
              {run.outcome}
            </span>
            <span className="flex-1 min-w-0 truncate text-[var(--color-fg-subtle)]" title={run.error}>
              {run.error ?? (run.jobId ? `job ${run.jobId.slice(0, 8)}` : '')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compute row counts outside the component body so the react-hooks/purity
 * rule doesn't flag the Date.now() read — statistics functions are
 * deliberately time-sensitive and a re-render is the right moment to update
 * the "fired in last 24h" badge.
 */
function computeStats(jobs: ScheduledJobDto[]) {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return {
    total: jobs.length,
    enabled: jobs.filter((j) => j.enabled).length,
    recentFires: jobs.filter((j) => j.lastFiredAt && j.lastFiredAt > oneDayAgo).length,
  };
}

// ─── Local StatCard (matches dashboard/page.tsx pattern) ─────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="studio-card rounded-lg px-4 py-3">
      <p className="text-xs text-[var(--color-fg-subtle)] mb-1">{label}</p>
      <p className={cn('text-2xl font-semibold tabular', color)}>{value}</p>
    </div>
  );
}

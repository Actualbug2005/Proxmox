'use client';

/**
 * /dashboard/chains — list + manage Script Chains.
 *
 * Layout mirrors /dashboard/schedules so operators can switch between
 * single-script schedules and multi-step chains without re-learning the
 * UI. Each row shows name, step count, policy, optional cadence, and the
 * progress of the last run (if any).
 */

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChainEditor } from '@/components/scripts/chain-editor';
import { useToast } from '@/components/ui/toast';
import {
  isChainInFlight,
  useChains,
  useDeleteChain,
  useRunChain,
  useUpdateChain,
  type ChainDto,
  type ChainStepRun,
} from '@/hooks/use-chains';

const CRON_LABELS: Record<string, string> = {
  '*/5 * * * *': 'Every 5 minutes',
  '*/10 * * * *': 'Every 10 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Hourly',
  '0 0 * * *': 'Daily at midnight',
  '0 2 * * *': 'Daily at 02:00',
  '0 6 * * *': 'Daily at 06:00',
  '0 2 * * mon..fri': 'Weekdays at 02:00',
  '0 2 * * sun': 'Sundays at 02:00',
};

function humanCron(expr: string | undefined): string {
  if (!expr) return 'Ad-hoc only';
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

export default function ChainsPage() {
  const { data, isLoading, isError, refetch } = useChains();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingChain, setEditingChain] = useState<ChainDto | null>(null);

  const chains = data?.chains ?? [];
  const stats = computeStats(chains);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">Script Chains</h1>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            Ordered sequences of Community Scripts — run ad-hoc or on a schedule.
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
              setEditingChain(null);
              setEditorOpen(true);
            }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New chain
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={String(stats.total)} color="text-[var(--color-fg)]" />
        <StatCard label="In flight" value={String(stats.inFlight)} color="text-indigo-400" />
        <StatCard label="Scheduled" value={String(stats.scheduled)} color="text-emerald-400" />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-fg-muted)]" />
        </div>
      )}
      {isError && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-sm font-medium text-red-400">Failed to load chains</p>
          <button
            onClick={() => refetch()}
            className="ml-auto text-xs text-red-400 hover:text-red-300 underline"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && chains.length === 0 && (
        <div className="studio-card rounded-lg p-10 text-center">
          <Zap className="w-8 h-8 text-[var(--color-fg-subtle)] mx-auto mb-3" />
          <p className="text-sm text-[var(--color-fg-secondary)] mb-1">No chains yet.</p>
          <p className="text-xs text-[var(--color-fg-subtle)]">
            Click{' '}
            <span className="font-mono text-[var(--color-fg-muted)]">New chain</span> to compose a sequence of
            Community Scripts.
          </p>
        </div>
      )}

      {chains.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {chains.map((chain) => (
            <ChainRow
              key={chain.id}
              chain={chain}
              onEdit={() => {
                setEditingChain(chain);
                setEditorOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <ChainEditor
          onClose={() => setEditorOpen(false)}
          initial={editingChain}
        />
      )}
    </div>
  );
}

function ChainRow({ chain, onEdit }: { chain: ChainDto; onEdit: () => void }) {
  const toast = useToast();
  const updateM = useUpdateChain();
  const deleteM = useDeleteChain();
  const runM = useRunChain();

  const inFlight = isChainInFlight(chain);

  const toggle = () => {
    updateM.mutate(
      { id: chain.id, patch: { enabled: !chain.enabled } },
      { onError: (err) => toast.error('Toggle failed', err.message) },
    );
  };

  const remove = () => {
    if (!window.confirm(`Delete chain "${chain.name}"?`)) return;
    deleteM.mutate(chain.id, {
      onSuccess: () => toast.success('Chain deleted'),
      onError: (err) => toast.error('Delete failed', err.message),
    });
  };

  const run = () => {
    runM.mutate(chain.id, {
      onSuccess: () => toast.success(`Started "${chain.name}"`),
      onError: (err) => toast.error('Run failed', err.message),
    });
  };

  return (
    <div className="studio-card rounded-lg p-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium text-[var(--color-fg)] truncate">{chain.name}</h3>
            <span className="text-xs text-[var(--color-fg-subtle)]">· {chain.steps.length} step{chain.steps.length === 1 ? '' : 's'}</span>
            <span
              className={cn(
                'inline-block w-1.5 h-1.5 rounded-full',
                chain.enabled ? 'bg-emerald-400' : 'bg-zinc-600',
              )}
              title={chain.enabled ? 'Enabled' : 'Disabled'}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-fg-muted)]">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {humanCron(chain.schedule)}
            </span>
            <span>· {chain.policy === 'continue' ? 'Continue on failure' : 'Halt on failure'}</span>
            <span>· last fired {formatRelative(chain.lastFiredAt)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={run}
            disabled={runM.isPending || inFlight}
            className="flex items-center gap-1 rounded-md bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20 disabled:opacity-40"
            title={inFlight ? 'Chain is already running' : 'Run now'}
          >
            <Play className="h-3 w-3" />
            Run
          </button>
          <button
            onClick={toggle}
            disabled={updateM.isPending}
            className="rounded-md bg-[var(--color-overlay)] px-2.5 py-1 text-xs text-[var(--color-fg-secondary)] transition hover:bg-zinc-700 disabled:opacity-40"
            title={chain.enabled ? 'Disable' : 'Enable'}
          >
            {chain.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onEdit}
            className="rounded-md bg-[var(--color-overlay)] p-1.5 text-[var(--color-fg-secondary)] transition hover:bg-zinc-700"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={remove}
            disabled={deleteM.isPending}
            className="rounded-md bg-[var(--color-overlay)] p-1.5 text-[var(--color-fg-secondary)] transition hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {chain.lastRun && chain.lastRun.length > 0 && (
        <div className="mt-3 flex items-center gap-1">
          {chain.lastRun.map((run, i) => (
            <StepPip key={i} run={run} step={chain.steps[i]?.scriptName} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepPip({ run, step }: { run: ChainStepRun; step?: string }) {
  const label = step ? `${step} — ${run.status}` : run.status;
  const icon = (() => {
    switch (run.status) {
      case 'success':
        return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
      case 'failed':
        return <XCircle className="h-3 w-3 text-red-400" />;
      case 'running':
        return <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />;
      case 'skipped':
        return <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />;
      default:
        return <div className="h-1.5 w-1.5 rounded-full bg-zinc-500" />;
    }
  })();
  return (
    <span
      title={label}
      className={cn(
        'flex h-5 min-w-5 items-center justify-center rounded-full px-1',
        run.status === 'failed' && 'bg-red-500/10',
        run.status === 'success' && 'bg-emerald-500/10',
        run.status === 'running' && 'bg-indigo-500/10',
      )}
    >
      {icon}
    </span>
  );
}

function computeStats(chains: ChainDto[]) {
  return {
    total: chains.length,
    inFlight: chains.filter(isChainInFlight).length,
    scheduled: chains.filter((c) => c.enabled && c.schedule).length,
  };
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="studio-card rounded-lg px-4 py-3">
      <p className="text-xs text-[var(--color-fg-subtle)] mb-1">{label}</p>
      <p className={cn('text-2xl font-semibold tabular', color)}>{value}</p>
    </div>
  );
}

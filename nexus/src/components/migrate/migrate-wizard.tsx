'use client';

/**
 * Intelligent Migration Wizard.
 *
 * Three steps: Source → Target (ranked) → Confirm.
 *
 *   Step 1: display the guest's identity + the resources the wizard is
 *           about to move around. Auto-enables Next.
 *   Step 2: calls useCandidateTargets — cluster resources + per-node
 *           status + PVE precondition → ranked ScoredTarget[]. User
 *           clicks a non-disqualified row. The first 'recommended' row
 *           is preselected once data arrives.
 *   Step 3: source → target summary + online (QEMU) / restart (LXC)
 *           toggle + Migrate button. On success, calls onSuccess (the
 *           VM/CT detail page navigates to its list view).
 *
 * Shape conventions match the existing single-dialog pattern in
 * vms/[node]/[vmid]/page.tsx — vanilla useState, handrolled modal shell,
 * in-button Loader2 spinner on submit.
 */

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoveRight,
  Server,
  X,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  useCandidateTargets,
  useMigrateGuest,
  type GuestType,
} from '@/hooks/use-migration';
import type { ScoredTarget } from '@/lib/migration-score';

// ─── Props ───────────────────────────────────────────────────────────────────

interface MigrateWizardProps {
  guestType: GuestType;
  sourceNode: string;
  vmid: number;
  vmName?: string;
  isRunning: boolean;
  /** vCPU count (from config.cores × sockets for QEMU, config.cores for LXC). */
  cores: number;
  /** Configured memory in BYTES. Callers convert from MB (config.memory) before passing. */
  memoryBytes: number;
  onClose: () => void;
  /** Called after the migration POST returns 2xx with the UPID. */
  onSuccess?: () => void;
}

// ─── Shell ───────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Source', 'Target', 'Confirm'] as const;

export function MigrateWizard({
  guestType,
  sourceNode,
  vmid,
  vmName,
  isRunning,
  cores,
  memoryBytes,
  onClose,
  onSuccess,
}: MigrateWizardProps) {
  const toast = useToast();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  // Default the live toggle to the running state — matches the existing dialog.
  const [onlineToggle, setOnlineToggle] = useState(isRunning);

  const ask = useMemo(
    () => ({ vmid, cores, memoryBytes, sourceNode }),
    [vmid, cores, memoryBytes, sourceNode],
  );

  const { scored, loading, error } = useCandidateTargets({
    guestType,
    sourceNode,
    vmid,
    ask,
  });

  const migrate = useMigrateGuest();

  // Preselect the first non-disqualified row as a *derived* value rather
  // than syncing state in an effect — avoids react-hooks/set-state-in-effect
  // and keeps selection reactive to score shuffles as pressure changes.
  const autoPicked = scored.find((s) => !s.disqualified)?.node ?? null;
  const effectiveTarget = selectedTarget ?? autoPicked;
  const picked = scored.find((s) => s.node === effectiveTarget) ?? null;
  const canGoToTarget = !loading && !error;
  const canGoToConfirm = picked !== null && !picked.disqualified;

  const submit = () => {
    if (!picked || picked.disqualified) return;
    migrate.mutate(
      guestType === 'qemu'
        ? {
            guestType,
            sourceNode,
            vmid,
            target: picked.node,
            online: onlineToggle,
          }
        : {
            guestType,
            sourceNode,
            vmid,
            target: picked.node,
            restart: onlineToggle,
          },
      {
        onSuccess: () => {
          toast.success('Migration started');
          onSuccess?.();
          onClose();
        },
        onError: (err) => toast.error('Migration failed', err.message),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <div className="studio-card p-6 w-full max-w-2xl shadow-2xl">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-2">
            <MoveRight className="w-4 h-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-white">
              Migrate {guestType === 'qemu' ? 'VM' : 'CT'} {vmName ? `"${vmName}"` : ''}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <StepIndicator step={step} />

        <div className="mt-5 min-h-[260px]">
          {step === 0 && (
            <StepSource
              guestType={guestType}
              sourceNode={sourceNode}
              vmid={vmid}
              vmName={vmName}
              isRunning={isRunning}
              cores={cores}
              memoryBytes={memoryBytes}
            />
          )}
          {step === 1 && (
            <StepTarget
              loading={loading}
              error={error}
              scored={scored}
              selectedTarget={effectiveTarget}
              setSelectedTarget={setSelectedTarget}
            />
          )}
          {step === 2 && picked && (
            <StepConfirm
              guestType={guestType}
              sourceNode={sourceNode}
              vmName={vmName ?? String(vmid)}
              target={picked}
              isRunning={isRunning}
              onlineToggle={onlineToggle}
              setOnlineToggle={setOnlineToggle}
              pveError={migrate.error?.message ?? null}
            />
          )}
        </div>

        {/* Nav row */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => (step > 0 ? setStep((step - 1) as 0 | 1 | 2) : onClose())}
            disabled={migrate.isPending}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
            {step > 0 ? 'Back' : 'Cancel'}
          </button>
          {step < 2 && (
            <button
              onClick={() => setStep(((step + 1) as 0 | 1 | 2))}
              disabled={(step === 0 ? !canGoToTarget : false) || (step === 1 ? !canGoToConfirm : false)}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium bg-zinc-300 hover:bg-zinc-200 text-zinc-900 rounded-lg transition disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {step === 2 && (
            <button
              onClick={submit}
              disabled={migrate.isPending || !picked || picked.disqualified}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg transition disabled:opacity-40"
            >
              {migrate.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MoveRight className="w-4 h-4" />
              )}
              Migrate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 0 | 1 | 2 }) {
  return (
    <div className="flex items-center gap-0">
      {STEP_LABELS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-initial">
            <div
              className={cn(
                'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition',
                done && 'bg-indigo-500 text-white',
                active && !done && 'bg-zinc-200 text-zinc-900 ring-2 ring-indigo-400 ring-offset-2 ring-offset-zinc-900',
                !done && !active && 'bg-zinc-800 text-zinc-500',
              )}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                'ml-2 text-xs font-medium',
                active ? 'text-zinc-100' : done ? 'text-zinc-400' : 'text-zinc-600',
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-px mx-3',
                  done ? 'bg-indigo-500/60' : 'bg-zinc-800',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Source ──────────────────────────────────────────────────────────

function StepSource({
  guestType,
  sourceNode,
  vmid,
  vmName,
  isRunning,
  cores,
  memoryBytes,
}: {
  guestType: GuestType;
  sourceNode: string;
  vmid: number;
  vmName?: string;
  isRunning: boolean;
  cores: number;
  memoryBytes: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-300">
        This wizard will migrate the {guestType === 'qemu' ? 'VM' : 'LXC container'} below to
        a target node chosen from the live cluster pressure snapshot.
      </p>
      <div className="studio-card rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-100">{vmName ?? `#${vmid}`}</span>
          <span className="text-xs font-mono text-zinc-500">({vmid})</span>
          <Badge variant={isRunning ? 'success' : 'outline'}>
            {isRunning ? 'running' : 'stopped'}
          </Badge>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-zinc-500">Source node</dt>
            <dd className="text-zinc-200 font-mono">{sourceNode}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">vCPU</dt>
            <dd className="text-zinc-200 tabular">{cores}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Memory</dt>
            <dd className="text-zinc-200 tabular">{formatBytes(memoryBytes)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// ─── Step 2: Target ──────────────────────────────────────────────────────────

function StepTarget({
  loading,
  error,
  scored,
  selectedTarget,
  setSelectedTarget,
}: {
  loading: boolean;
  error: Error | null;
  scored: ScoredTarget[];
  selectedTarget: string | null;
  setSelectedTarget: (n: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Analysing cluster pressure…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm">
        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-red-300 font-medium">Could not load precondition</p>
          <p className="text-red-400/80 text-xs mt-0.5">{error.message}</p>
        </div>
      </div>
    );
  }
  if (scored.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-10">
        No other nodes in this cluster.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Ranked by score — lower cluster pressure at the time of checking scores higher.
        Disqualified rows cannot be chosen.
      </p>
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
        {scored.map((row) => (
          <TargetRow
            key={row.node}
            row={row}
            selected={selectedTarget === row.node}
            onSelect={() => !row.disqualified && setSelectedTarget(row.node)}
          />
        ))}
      </div>
    </div>
  );
}

function TargetRow({
  row,
  selected,
  onSelect,
}: {
  row: ScoredTarget;
  selected: boolean;
  onSelect: () => void;
}) {
  const disabled = row.disqualified;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'w-full text-left rounded-lg p-3 border transition flex items-center gap-3',
        selected && !disabled && 'border-indigo-400/60 bg-indigo-500/10',
        !selected && !disabled && 'border-zinc-800/60 bg-zinc-900 hover:bg-zinc-800/60',
        disabled && 'border-zinc-800/40 bg-zinc-900/40 cursor-not-allowed opacity-60',
      )}
    >
      <div className="w-8 h-8 shrink-0 rounded-md bg-zinc-800 flex items-center justify-center text-xs font-mono tabular">
        {disabled ? '—' : Math.round(row.score)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100 font-mono">{row.node}</span>
          <TargetBadge label={row.label} />
        </div>
        {!disabled ? (
          <div className="text-xs text-zinc-500 flex items-center gap-3 mt-0.5">
            <span>CPU headroom <span className="text-zinc-300 tabular">{row.fit.cpuHeadroomPct}%</span></span>
            <span>·</span>
            <span>Mem headroom <span className="text-zinc-300 tabular">{row.fit.memHeadroomPct}%</span></span>
          </div>
        ) : (
          <div className="text-xs text-red-400/80 mt-0.5 truncate" title={row.reasons.join('; ')}>
            {row.reasons[0] ?? 'not allowed'}
          </div>
        )}
      </div>
    </button>
  );
}

function TargetBadge({ label }: { label: ScoredTarget['label'] }) {
  if (label === 'recommended') return <Badge variant="success">recommended</Badge>;
  if (label === 'ok') return <Badge variant="info">ok</Badge>;
  if (label === 'tight') return <Badge variant="warning">tight</Badge>;
  return <Badge variant="danger">not allowed</Badge>;
}

// ─── Step 3: Confirm ─────────────────────────────────────────────────────────

function StepConfirm({
  guestType,
  sourceNode,
  vmName,
  target,
  isRunning,
  onlineToggle,
  setOnlineToggle,
  pveError,
}: {
  guestType: GuestType;
  sourceNode: string;
  vmName: string;
  target: ScoredTarget;
  isRunning: boolean;
  onlineToggle: boolean;
  setOnlineToggle: (v: boolean) => void;
  pveError: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="studio-card rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 text-center">
            <div className="text-xs text-zinc-500">From</div>
            <div className="text-sm font-medium text-zinc-100 font-mono">{sourceNode}</div>
          </div>
          <MoveRight className="w-4 h-4 text-indigo-300 shrink-0" />
          <div className="flex-1 text-center">
            <div className="text-xs text-zinc-500">To</div>
            <div className="text-sm font-medium text-zinc-100 font-mono">{target.node}</div>
            <div className="mt-1 flex justify-center">
              <TargetBadge label={target.label} />
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs text-zinc-500 text-center">
          Migrating <span className="text-zinc-300">{vmName}</span> — target score{' '}
          <span className="text-zinc-300 tabular">{Math.round(target.score)}</span>, CPU headroom
          after placement <span className="text-zinc-300 tabular">{target.fit.cpuHeadroomPct}%</span>,
          mem <span className="text-zinc-300 tabular">{target.fit.memHeadroomPct}%</span>.
        </div>
      </div>

      {isRunning && (
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={onlineToggle}
            onChange={(e) => setOnlineToggle(e.target.checked)}
            className="rounded border-gray-600"
          />
          {guestType === 'qemu'
            ? 'Live migration (transfer running memory state)'
            : 'Restart on target after migration'}
        </label>
      )}

      {pveError && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <div className="text-red-300">{pveError}</div>
        </div>
      )}
    </div>
  );
}

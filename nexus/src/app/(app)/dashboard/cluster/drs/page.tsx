'use client';

/**
 * Auto-DRS policy editor + recent-actions log.
 *
 * Single page, two sections:
 *
 *   1. Mode + policy knobs — a compact form that PATCHes partial
 *      updates as the operator edits. Save-on-blur UX would be nicer
 *      but inconsistent with the rest of the app (see schedules /
 *      notifications rule editor); sticking with explicit Save.
 *
 *   2. Recent history — last 50 entries from the in-process ring.
 *      Outcome badges + optional detail columns (vmid, source→target,
 *      score delta). Failures render with a red-tinted row so an
 *      operator scanning the page sees them without reading every row.
 */
import { useState } from 'react';
import {
  Loader2, Sliders, AlertTriangle, ArrowRight, CheckCircle2, XCircle, MinusCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { useDrsState, useUpdateDrsPolicy } from '@/hooks/use-drs';
import type {
  DrsHistoryEntry,
  DrsMode,
  DrsPolicy,
} from '@/lib/drs/types';

const MODE_OPTIONS = [
  { value: 'off',      label: 'Off' },
  { value: 'dry-run',  label: 'Dry-run' },
  { value: 'enabled',  label: 'Enabled' },
] as const satisfies ReadonlyArray<{ value: DrsMode; label: string }>;

const MODE_HINT: Record<DrsMode, string> = {
  'off':      'The loop runs but evaluates nothing. No events, no moves.',
  'dry-run':  'Plans every minute and emits drs.would.migrate events — no actual migrations.',
  'enabled':  'Plans and migrates. Up to one move per minute. Subject to cooldowns + blackout windows.',
};

export default function DrsPage() {
  const { data, isLoading, error } = useDrsState();
  const update = useUpdateDrsPolicy();
  const toast = useToast();

  // Local draft — overlay on top of the server policy. `null` means
  // "no pending edits; show the server state as-is." React 19 / Next 16
  // lint forbids setState-in-useEffect for this kind of hydration, so
  // we render `draft ?? data.policy` everywhere and populate draft
  // only when the operator actually edits a field.
  const [draft, setDraft] = useState<DrsPolicy | null>(null);

  const policy: DrsPolicy | null = draft ?? data?.policy ?? null;
  const dirty = !!(draft && data && JSON.stringify(draft) !== JSON.stringify(data.policy));

  function save() {
    if (!draft) return;
    update.mutate(draft, {
      onSuccess: () => toast.success('DRS policy saved'),
      onError: (err) => toast.error('Save failed', err.message),
    });
  }
  function discard() {
    if (data) setDraft(data.policy);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
          <Sliders className="w-5 h-5 text-[var(--color-fg-muted)]" />
          Auto-DRS
        </h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          Distributed Resource Scheduler. Watches cluster pressure and
          migrates a single guest per tick when a node is clearly hotter
          than the cluster mean. Dry-run mode emits events via the
          notification engine so you can see what it <em>would</em> have
          done before flipping to Enabled.
        </p>
      </header>

      {isLoading && (
        <div className="studio-card p-10 flex items-center justify-center text-[var(--color-fg-subtle)]">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
      {error && (
        <div className="studio-card p-6 text-sm text-[var(--color-err)] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {policy && (
        <>
          {/* Mode + save/discard */}
          <section className="studio-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest mb-2">Mode</p>
                <Segmented
                  value={policy.mode}
                  onChange={(v) => setDraft({ ...policy, mode: v })}
                  options={MODE_OPTIONS}
                  ariaLabel="DRS mode"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={discard} disabled={!dirty}>Discard</Button>
                <Button onClick={save} disabled={!dirty || update.isPending}>
                  {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Save changes
                </Button>
              </div>
            </div>
            <p className="text-xs text-[var(--color-fg-faint)]">
              {MODE_HINT[policy.mode]}
            </p>
          </section>

          {/* Knobs — only show when mode ≠ off, to reduce noise */}
          {policy.mode !== 'off' && (
            <section className="studio-card p-5 space-y-5">
              <h2 className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
                Thresholds
              </h2>

              <div className="grid grid-cols-3 gap-4">
                <Slider
                  label="Hot CPU (absolute)"
                  hint="Node is a candidate when CPU exceeds this."
                  value={policy.hotCpuAbs}
                  min={0.5} max={1} step={0.01}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) => setDraft({ ...policy, hotCpuAbs: v })}
                />
                <Slider
                  label="Hot memory (absolute)"
                  hint="Node is a candidate when memory utilisation exceeds this."
                  value={policy.hotMemAbs}
                  min={0.5} max={1} step={0.01}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) => setDraft({ ...policy, hotMemAbs: v })}
                />
                <Slider
                  label="Relative excess above mean"
                  hint="Node must also exceed the cluster mean by this fraction."
                  value={policy.relativeDelta}
                  min={0} max={0.5} step={0.01}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) => setDraft({ ...policy, relativeDelta: v })}
                />
              </div>

              <h2 className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
                Safety rails
              </h2>

              <div className="grid grid-cols-3 gap-4">
                <Slider
                  label="Score-delta hysteresis"
                  hint="Target must be this many points better than source before moving."
                  value={policy.scoreDelta}
                  min={0} max={60} step={1}
                  format={(v) => `${v.toFixed(0)} pts`}
                  onChange={(v) => setDraft({ ...policy, scoreDelta: v })}
                />
                <Slider
                  label="Per-guest cooldown"
                  hint="Minimum gap between consecutive moves of the same guest."
                  value={policy.cooldownMin}
                  min={1} max={180} step={1}
                  format={(v) => `${v.toFixed(0)} min`}
                  onChange={(v) => setDraft({ ...policy, cooldownMin: v })}
                />
                <Field label="Blackout cron (optional)" hint="Ticks in a matching window are skipped. Same grammar as scheduled jobs.">
                  <input
                    value={policy.blackoutCron ?? ''}
                    onChange={(e) => setDraft({
                      ...policy,
                      blackoutCron: e.target.value ? (e.target.value as DrsPolicy['blackoutCron']) : undefined,
                    })}
                    placeholder="0 2-6 * * *"
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field
                label="Pinned-tag opt-out"
                hint="Guests carrying this PVE tag are never migrated by DRS. Change only if the default collides with an existing tag."
              >
                <input
                  value={policy.pinnedTag}
                  onChange={(e) => setDraft({ ...policy, pinnedTag: e.target.value })}
                  className={inputCls + ' max-w-xs'}
                />
              </Field>
            </section>
          )}

          {/* Recent history */}
          <section className="studio-card overflow-hidden">
            <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
                Recent actions
              </h2>
              <p className="text-xs text-[var(--color-fg-faint)]">last {data?.history.length ?? 0} · refreshes every 30 s</p>
            </header>
            {(!data || data.history.length === 0) ? (
              <div className="p-10 text-center text-sm text-[var(--color-fg-faint)]">
                No DRS activity yet. The tick runs every minute — try dry-run
                mode and watch this space.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left px-4 py-2 font-medium">When</th>
                    <th className="text-left px-4 py-2 font-medium w-10"></th>
                    <th className="text-left px-4 py-2 font-medium">Outcome</th>
                    <th className="text-left px-4 py-2 font-medium">Move</th>
                    <th className="text-right px-4 py-2 font-medium">Δ score</th>
                    <th className="text-left px-4 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h, i) => (
                    <HistoryRow key={`${h.at}-${i}`} entry={h} />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Presentation helpers ──────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50';

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-[var(--color-fg-subtle)] block mb-1.5 uppercase tracking-widest">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--color-fg-faint)] mt-1">{hint}</p>}
    </div>
  );
}

function Slider({
  label, hint, value, min, max, step, format, onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">{label}</label>
        <span className="text-xs tabular font-mono text-[var(--color-fg)]">{format(value)}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-cta)]"
      />
      {hint && <p className="text-xs text-[var(--color-fg-faint)] mt-1">{hint}</p>}
    </div>
  );
}

function HistoryRow({ entry }: { entry: DrsHistoryEntry }) {
  return (
    <tr className={cn(
      'border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-overlay)]/50 transition',
      entry.outcome === 'skipped' && entry.reason?.includes('failed') && 'bg-[var(--color-err)]/5',
    )}>
      <td className="px-4 py-2 text-xs text-[var(--color-fg-subtle)] tabular font-mono whitespace-nowrap">
        {new Date(entry.at).toLocaleString()}
      </td>
      <td className="px-4 py-2"><OutcomeIcon outcome={entry.outcome} /></td>
      <td className="px-4 py-2">
        <OutcomeBadge outcome={entry.outcome} mode={entry.mode} />
      </td>
      <td className="px-4 py-2 text-xs text-[var(--color-fg-secondary)] tabular font-mono">
        {entry.vmid ? (
          <span className="inline-flex items-center gap-1">
            {entry.sourceNode} <ArrowRight className="w-3 h-3 text-[var(--color-fg-subtle)]" /> {entry.targetNode}
            <span className="text-[var(--color-fg-subtle)] ml-2">vmid {entry.vmid}</span>
          </span>
        ) : (
          <span className="text-[var(--color-fg-faint)]">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular font-mono text-xs text-[var(--color-fg-subtle)]">
        {entry.scoreDelta != null ? Math.round(entry.scoreDelta) : '—'}
      </td>
      <td className="px-4 py-2 text-xs text-[var(--color-fg-subtle)]">
        {entry.reason ?? ''}
      </td>
    </tr>
  );
}

function OutcomeIcon({ outcome }: { outcome: DrsHistoryEntry['outcome'] }) {
  if (outcome === 'moved')      return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-ok)]" />;
  if (outcome === 'would-move') return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-fg-subtle)]" />;
  if (outcome === 'no-action')  return <MinusCircle className="w-3.5 h-3.5 text-[var(--color-fg-faint)]" />;
  return <XCircle className="w-3.5 h-3.5 text-[var(--color-err)]" />;
}

function OutcomeBadge({ outcome, mode }: { outcome: DrsHistoryEntry['outcome']; mode: DrsHistoryEntry['mode'] }) {
  if (outcome === 'moved')      return <Badge variant="success">moved</Badge>;
  if (outcome === 'would-move') return <Badge variant="info">would-move</Badge>;
  if (outcome === 'no-action')  return <Badge variant="outline">no-action</Badge>;
  // skipped comes in two flavours: mode=off (expected, every tick) or
  // a failure reason. Use mode to render different shades.
  return mode === 'off' ? <Badge variant="outline">skipped</Badge> : <Badge variant="warning">skipped</Badge>;
}

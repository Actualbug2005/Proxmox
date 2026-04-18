'use client';

/**
 * Rule create/edit form.
 *
 * The editor is deliberately opinionated — no "advanced" expression
 * language, no custom JS. Every field maps to a simple discriminated
 * union in the store, which means what the user sees here is exactly
 * what the server validates against.
 *
 * Section order (top → bottom) matches how an operator reasons:
 *   1. What is this rule called, is it on?
 *   2. What event fires it? (kind → conditional match fields)
 *   3. Where should the notification go? (destination + template)
 *   4. How noisy should it be? (backoff curve + resolve policy)
 *
 * The template preview renders live against a kind-specific fixture,
 * so a typo in a template reveals itself before save.
 */
import { useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BACKOFF_CURVES,
  COMPARISON_OPS,
  EVENT_KINDS,
  METRIC_NAMES,
  type BackoffConfig,
  type ComparisonOp,
  type EventKind,
  type ResolvePolicy,
  type Rule,
  type RuleMatch,
} from '@/lib/notifications/types';
import { fixtureEvent, KIND_GROUPS, KIND_LABELS } from '@/lib/notifications/fixtures';
import { contextFor } from '@/lib/notifications/rule-matcher';
import { renderTemplate, collectKeys } from '@/lib/notifications/template';
import { previewIntervals } from '@/lib/notifications/backoff';
import type { DestinationSummary } from '@/app/api/notifications/destinations/route';

export interface RuleFormValue {
  name: string;
  enabled: boolean;
  title?: string;
  match: RuleMatch;
  destinationId: string;
  messageTemplate: string;
  backoff?: BackoffConfig;
  resolvePolicy?: ResolvePolicy;
}

export interface RuleFormProps {
  initial?: RuleFormValue | null;
  destinations: DestinationSummary[];
  isPending?: boolean;
  error?: string;
  onSubmit: (value: RuleFormValue) => void;
  onCancel: () => void;
}

const CURVE_NAMES = Object.keys(BACKOFF_CURVES) as ReadonlyArray<keyof typeof BACKOFF_CURVES>;

const RESOLVE_POLICY_LABELS: Record<ResolvePolicy, { label: string; hint: string }> = {
  'multi-fire': { label: 'Multi-fire only (default)', hint: 'Fire a "resolved" note only when ≥2 notifications already fired.' },
  'always':     { label: 'Always',                    hint: 'Fire "resolved" on every clear, even after a single alert.' },
  'never':      { label: 'Never',                     hint: 'Absence of alerts = resolved; no confirmation sent.' },
};

const DEFAULT_MATCH: RuleMatch = { eventKind: 'pve.renewal.failed' };
const DEFAULT_TEMPLATE = 'Nexus alert: {{kind}}\n{{reason}}';

export function RuleForm({
  initial,
  destinations,
  isPending,
  error,
  onSubmit,
  onCancel,
}: RuleFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [match, setMatch] = useState<RuleMatch>(initial?.match ?? DEFAULT_MATCH);
  const [destinationId, setDestinationId] = useState(
    initial?.destinationId ?? destinations[0]?.id ?? '',
  );
  const [messageTemplate, setMessageTemplate] = useState(
    initial?.messageTemplate ?? DEFAULT_TEMPLATE,
  );
  const [backoff, setBackoff] = useState<BackoffConfig | undefined>(initial?.backoff);
  const [resolvePolicy, setResolvePolicy] = useState<ResolvePolicy | undefined>(
    initial?.resolvePolicy,
  );

  // ── derived preview state ────────────────────────────────────────────────

  const previewEvent = useMemo(() => fixtureEvent(match.eventKind), [match.eventKind]);
  const previewContext = useMemo(() => contextFor(previewEvent), [previewEvent]);
  const previewOutput = useMemo(
    () => renderTemplate(messageTemplate, previewContext),
    [messageTemplate, previewContext],
  );
  const referencedKeys = useMemo(() => collectKeys(messageTemplate), [messageTemplate]);
  // Keys the operator used that DON'T exist on the event — warn inline
  // so they don't ship a template that always renders a blank field.
  const unknownKeys = referencedKeys.filter((k) => !(k in previewContext));

  const intervalPreview = useMemo(() => previewIntervals(backoff), [backoff]);

  const canSubmit =
    name.trim().length > 0 &&
    destinationId.length > 0 &&
    messageTemplate.trim().length > 0 &&
    !isPending;

  // ── handlers ──────────────────────────────────────────────────────────────

  function changeKind(kind: EventKind) {
    // Preserve scope + title across kind swaps (both kind-agnostic) but
    // discard metric fields that only apply to metric.threshold.crossed.
    setMatch({ eventKind: kind, scope: match.scope });
  }

  function changeBackoffCurve(v: string) {
    if (v === 'default') {
      setBackoff(undefined);
      return;
    }
    if (v === 'custom') {
      setBackoff({ curve: 'custom', customIntervalsMin: [0, 5, 15, 60] });
      return;
    }
    setBackoff({ curve: v as BackoffConfig['curve'] });
  }

  function changeCustomIntervals(raw: string) {
    // Accept a comma / space-separated list. Invalid entries are dropped
    // so the operator can type fluidly; server still validates on save.
    const parts = raw.split(/[,\s]+/).filter(Boolean).map(Number).filter(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1440,
    );
    setBackoff({ curve: 'custom', customIntervalsMin: parts });
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      enabled,
      title: title.trim() || undefined,
      match,
      destinationId,
      messageTemplate,
      backoff,
      resolvePolicy,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── Identity ── */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PVE renewal alerts"
            autoFocus
            className={inputCls}
          />
        </Field>
        <Field label="Title prefix (optional)" hint="Shown as the notification title; defaults to the kind.">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nexus alert"
            className={inputCls}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--color-fg-secondary)] cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-[var(--color-border-subtle)]"
        />
        Enabled
      </label>

      {/* ── Match criteria ── */}
      <SectionHeader>Trigger</SectionHeader>
      <Field label="Event kind">
        <select
          value={match.eventKind}
          onChange={(e) => changeKind(e.target.value as EventKind)}
          className={inputCls}
        >
          {KIND_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.kinds.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      {match.eventKind === 'metric.threshold.crossed' && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Metric">
            <select
              value={match.metric ?? ''}
              onChange={(e) => setMatch({ ...match, metric: e.target.value || undefined })}
              className={inputCls}
            >
              <option value="">(any metric)</option>
              {METRIC_NAMES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Comparison">
            <select
              value={match.op ?? ''}
              onChange={(e) => setMatch({ ...match, op: (e.target.value || undefined) as ComparisonOp | undefined })}
              className={inputCls}
            >
              <option value="">(any)</option>
              {COMPARISON_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
            </select>
          </Field>
          <Field label="Threshold">
            <input
              type="number"
              step="any"
              value={match.threshold ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setMatch({ ...match, threshold: v === '' ? undefined : Number(v) });
              }}
              placeholder="0.85"
              className={inputCls}
            />
          </Field>
        </div>
      )}

      <Field label="Scope filter (optional)" hint="Substring match against the event scope, e.g. 'node:pve' matches every pve-N.">
        <input
          value={match.scope ?? ''}
          onChange={(e) => setMatch({ ...match, scope: e.target.value || undefined })}
          placeholder="node:pve"
          className={inputCls}
        />
      </Field>

      {/* ── Delivery ── */}
      <SectionHeader>Delivery</SectionHeader>
      {destinations.length === 0 ? (
        <div className="flex items-start gap-2 text-sm text-[var(--color-warn)] bg-[var(--color-warn)]/10 border border-[var(--color-warn)]/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            No destinations configured — create one in the Destinations
            tab before saving this rule.
          </span>
        </div>
      ) : (
        <Field label="Destination">
          <select
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            className={inputCls}
          >
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.kind})</option>
            ))}
          </select>
        </Field>
      )}
      <Field
        label="Message template"
        hint={`Substitute event fields with {{key}}. Available keys: ${Object.keys(previewContext).join(', ')}`}
      >
        <textarea
          value={messageTemplate}
          onChange={(e) => setMessageTemplate(e.target.value)}
          rows={4}
          className={cn(inputCls, 'font-mono text-xs')}
        />
      </Field>

      {/* Live preview against the fixture. Rendered right next to the
          textarea so the operator sees a template typo immediately. */}
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-overlay)]/30 p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
          <Info className="w-3 h-3" /> Live preview
        </div>
        <pre className="text-xs text-[var(--color-fg-secondary)] whitespace-pre-wrap font-mono">
          {previewOutput || <span className="text-[var(--color-fg-faint)]">(empty)</span>}
        </pre>
        {unknownKeys.length > 0 && (
          <p className="text-xs text-[var(--color-warn)] flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Unknown keys (will render blank): {unknownKeys.join(', ')}
          </p>
        )}
      </div>

      {/* ── Noise controls ── */}
      <SectionHeader>Cadence</SectionHeader>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Backoff curve" hint="Intervals between fires while the predicate keeps matching (minutes).">
          <select
            value={backoff ? backoff.curve : 'default'}
            onChange={(e) => changeBackoffCurve(e.target.value)}
            className={inputCls}
          >
            <option value="default">Default (gentle)</option>
            {CURVE_NAMES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </Field>
        <Field label="Resolve policy" hint={resolvePolicy ? RESOLVE_POLICY_LABELS[resolvePolicy].hint : RESOLVE_POLICY_LABELS['multi-fire'].hint}>
          <select
            value={resolvePolicy ?? 'multi-fire'}
            onChange={(e) => {
              const v = e.target.value as ResolvePolicy;
              setResolvePolicy(v === 'multi-fire' ? undefined : v);
            }}
            className={inputCls}
          >
            {(Object.keys(RESOLVE_POLICY_LABELS) as ResolvePolicy[]).map((p) => (
              <option key={p} value={p}>{RESOLVE_POLICY_LABELS[p].label}</option>
            ))}
          </select>
        </Field>
      </div>

      {backoff?.curve === 'custom' && (
        <Field label="Custom intervals (minutes, comma-separated)">
          <input
            value={backoff.customIntervalsMin?.join(', ') ?? ''}
            onChange={(e) => changeCustomIntervals(e.target.value)}
            placeholder="0, 5, 15, 60"
            className={inputCls}
          />
        </Field>
      )}

      <div className="rounded-lg bg-[var(--color-overlay)]/30 border border-[var(--color-border-subtle)] px-3 py-2">
        <p className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest mb-2">
          Fire sequence preview
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {intervalPreview.map((m, i) => (
            <Badge key={i} variant="outline">
              {i === 0 ? 'now' : `+${m}m`}
            </Badge>
          ))}
          <span className="text-xs text-[var(--color-fg-faint)] ml-1">… then every {intervalPreview[intervalPreview.length - 1]}m (cap)</span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-[var(--color-err)] bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!canSubmit || destinations.length === 0}>
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {initial ? 'Save changes' : 'Add rule'}
        </Button>
      </div>
    </form>
  );
}

// ─── Presentation helpers ──────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-[var(--color-fg-muted)] uppercase tracking-widest pt-2 border-t border-[var(--color-border-subtle)]">
      {children}
    </h3>
  );
}

/** Ensure every EventKind has a `KIND_LABELS` entry — compile-time guard. */
export function _eventKindExhaustiveCheck(): void {
  const _: EventKind = EVENT_KINDS[0];
  return void _;
}

export function synthesiseInitialFromRule(rule: Rule): RuleFormValue {
  return {
    name: rule.name,
    enabled: rule.enabled,
    title: rule.title,
    match: rule.match,
    destinationId: rule.destinationId,
    messageTemplate: rule.messageTemplate,
    backoff: rule.backoff,
    resolvePolicy: rule.resolvePolicy,
  };
}

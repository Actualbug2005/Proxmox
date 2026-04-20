'use client';

/**
 * Four-step wizard for registering a remote PVE cluster:
 *
 *   1. Identity   — display name + auto-slugified id (editable)
 *   2. Endpoints  — 1-4 https URLs with reorder + add/remove
 *   3. API token  — tokenId + secret (password w/ show/hide)
 *   4. Confirm    — summary + Save
 *
 * POSTs to /api/federation/clusters via useCsrfMutation. There is NO
 * dry-run probe call here — the plan defers that; after save the row
 * shows its actual probe result.
 */
import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Network,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalShell } from '@/components/ui/modal-shell';
import { useToast } from '@/components/ui/toast';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';

interface AddClusterDialogProps {
  onClose: () => void;
}

const STEP_LABELS = ['Identity', 'Endpoints', 'API token', 'Confirm'] as const;
type Step = 0 | 1 | 2 | 3;

const MAX_ENDPOINTS = 4;

function slugify(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 32)
    || 'cluster';
}

function isHttpsUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

interface CreateClusterInput {
  id: string;
  name: string;
  endpoints: string[];
  tokenId: string;
  tokenSecret: string;
}

export function AddClusterDialog({ onClose }: AddClusterDialogProps) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(0);

  // Step 1
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);

  // Step 2
  const [endpoints, setEndpoints] = useState<string[]>(['https://']);

  // Step 3
  const [tokenId, setTokenId] = useState('');
  const [tokenSecret, setTokenSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Derived id (only auto-fills while the user hasn't manually edited it)
  const derivedId = useMemo(() => slugify(name || 'cluster'), [name]);
  const effectiveId = idTouched ? id : derivedId;

  const nameValid = name.trim().length >= 1 && name.trim().length <= 64;
  // Matches the server-side ID_RE in lib/federation/store.ts — first char
  // MUST be a lowercase letter. Keeping client in sync means the wizard
  // surfaces validation errors before POST, not after.
  const idValid = /^[a-z][a-z0-9-]{0,31}$/.test(effectiveId);
  const identityValid = nameValid && idValid;

  const endpointsTrimmed = endpoints.map((e) => e.trim()).filter(Boolean);
  const endpointsValid =
    endpointsTrimmed.length >= 1 &&
    endpointsTrimmed.length <= MAX_ENDPOINTS &&
    endpointsTrimmed.every(isHttpsUrl);

  const tokenIdValid = /^[^@]+@[^!]+![^\s!]+$/.test(tokenId.trim());
  const tokenSecretValid = tokenSecret.trim().length > 0;
  const tokenValid = tokenIdValid && tokenSecretValid;

  const mutation = useCsrfMutation<unknown, CreateClusterInput>({
    url: '/api/federation/clusters',
    method: 'POST',
    invalidateKeys: [['federation', 'clusters']],
  });

  function canAdvance(): boolean {
    if (step === 0) return identityValid;
    if (step === 1) return endpointsValid;
    if (step === 2) return tokenValid;
    return true;
  }

  function submit() {
    if (!identityValid || !endpointsValid || !tokenValid) return;
    mutation.mutate(
      {
        id: effectiveId,
        name: name.trim(),
        endpoints: endpointsTrimmed,
        tokenId: tokenId.trim(),
        tokenSecret: tokenSecret.trim(),
      },
      {
        onSuccess: () => {
          toast.success('Cluster registered');
          onClose();
        },
        onError: (err) => toast.error('Save failed', err.message),
      },
    );
  }

  return (
    <ModalShell size="2xl" onClose={mutation.isPending ? undefined : onClose}>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-[var(--color-fg-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">Register remote cluster</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] p-1 disabled:opacity-40"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <StepIndicator step={step} />

      <div className="mt-5 min-h-[280px]">
        {step === 0 && (
          <StepIdentity
            name={name}
            setName={setName}
            id={effectiveId}
            setId={(v) => {
              setId(v);
              setIdTouched(true);
            }}
            nameValid={nameValid}
            idValid={idValid}
          />
        )}
        {step === 1 && (
          <StepEndpoints
            endpoints={endpoints}
            setEndpoints={setEndpoints}
          />
        )}
        {step === 2 && (
          <StepToken
            tokenId={tokenId}
            setTokenId={setTokenId}
            tokenSecret={tokenSecret}
            setTokenSecret={setTokenSecret}
            showSecret={showSecret}
            setShowSecret={setShowSecret}
            tokenIdValid={tokenIdValid}
          />
        )}
        {step === 3 && (
          <StepConfirm
            name={name.trim()}
            id={effectiveId}
            endpoints={endpointsTrimmed}
            tokenId={tokenId.trim()}
            error={mutation.error?.message ?? null}
          />
        )}
      </div>

      <div className="flex items-center justify-between mt-6">
        <button
          type="button"
          onClick={() => (step > 0 ? setStep(((step - 1) as Step)) : onClose())}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
          {step > 0 ? 'Back' : 'Cancel'}
        </button>
        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep(((step + 1) as Step))}
            disabled={!canAdvance()}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] rounded-lg transition disabled:opacity-40"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] rounded-lg transition disabled:opacity-40"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save cluster
          </button>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
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
                done && 'bg-[var(--color-cta)] text-[var(--color-cta-fg)]',
                active && !done && 'bg-zinc-200 text-zinc-900 ring-2 ring-[var(--color-cta)] ring-offset-2 ring-offset-[var(--color-bg)]',
                !done && !active && 'bg-[var(--color-overlay)] text-[var(--color-fg-subtle)]',
              )}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                'ml-2 text-xs font-medium',
                active ? 'text-[var(--color-fg)]' : done ? 'text-[var(--color-fg-muted)]' : 'text-[var(--color-fg-faint)]',
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-px mx-3',
                  done ? 'bg-[var(--color-cta)]/60' : 'bg-[var(--color-overlay)]',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step bodies ────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50';

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs text-[var(--color-fg-subtle)] block mb-1.5 uppercase tracking-widest">
      {children}
    </label>
  );
}

function Hint({ children, variant = 'muted' }: { children: React.ReactNode; variant?: 'muted' | 'error' }) {
  return (
    <p className={cn('text-xs mt-1', variant === 'error' ? 'text-[var(--color-err)]' : 'text-[var(--color-fg-faint)]')}>
      {children}
    </p>
  );
}

function StepIdentity({
  name, setName, id, setId, nameValid, idValid,
}: {
  name: string;
  setName: (v: string) => void;
  id: string;
  setId: (v: string) => void;
  nameValid: boolean;
  idValid: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-fg-secondary)]">
        Give this cluster a display name — Nexus will auto-derive a URL-safe id you can tweak.
      </p>
      <div>
        <Label>Display name</Label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production DC-1"
          className={inputCls}
          maxLength={64}
          autoFocus
        />
        {!nameValid && name.length > 0 && <Hint variant="error">Name must be 1-64 characters.</Hint>}
      </div>
      <div>
        <Label>Cluster id</Label>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="production-dc-1"
          className={cn(inputCls, 'font-mono')}
          maxLength={32}
        />
        <Hint>Lowercase alphanumerics and hyphens, must start with a letter, max 32 chars. Used in proxy URLs.</Hint>
        {!idValid && <Hint variant="error">Id must match <code>[a-z][a-z0-9-]{'{0,31}'}</code>.</Hint>}
      </div>
    </div>
  );
}

function StepEndpoints({
  endpoints, setEndpoints,
}: {
  endpoints: string[];
  setEndpoints: (v: string[]) => void;
}) {
  function updateAt(i: number, v: string) {
    setEndpoints(endpoints.map((e, idx) => (idx === i ? v : e)));
  }
  function removeAt(i: number) {
    if (endpoints.length <= 1) return;
    setEndpoints(endpoints.filter((_, idx) => idx !== i));
  }
  function addOne() {
    if (endpoints.length >= MAX_ENDPOINTS) return;
    setEndpoints([...endpoints, 'https://']);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= endpoints.length) return;
    const next = endpoints.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setEndpoints(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-fg-secondary)]">
        Add 1-4 HTTPS endpoints for this cluster. Nexus will try them in order and fail over if one is unreachable.
      </p>
      <div className="space-y-2">
        {endpoints.map((ep, i) => {
          const trimmed = ep.trim();
          const invalid = trimmed.length > 0 && !isHttpsUrl(trimmed);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 text-xs font-mono tabular text-[var(--color-fg-subtle)] text-right">#{i + 1}</span>
              <input
                value={ep}
                onChange={(e) => updateAt(i, e.target.value)}
                placeholder="https://pve-node1.example.com:8006"
                className={cn(inputCls, 'flex-1 font-mono', invalid && 'border-[var(--color-err)]/60')}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-overlay)] transition disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === endpoints.length - 1}
                aria-label="Move down"
                className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-overlay)] transition disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={endpoints.length <= 1}
                aria-label="Remove"
                className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-err)] hover:bg-[var(--color-err)]/10 transition disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addOne}
        disabled={endpoints.length >= MAX_ENDPOINTS}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40"
      >
        <Plus className="w-3.5 h-3.5" />
        Add endpoint
      </button>
      <Hint>Only https:// URLs are accepted. PVE usually listens on :8006.</Hint>
    </div>
  );
}

function StepToken({
  tokenId, setTokenId, tokenSecret, setTokenSecret, showSecret, setShowSecret, tokenIdValid,
}: {
  tokenId: string;
  setTokenId: (v: string) => void;
  tokenSecret: string;
  setTokenSecret: (v: string) => void;
  showSecret: boolean;
  setShowSecret: (v: boolean) => void;
  tokenIdValid: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-fg-secondary)]">
        Create an API token in the remote cluster&apos;s UI at <em>Datacenter → Permissions → API Tokens</em>. Nexus never sees the PVE user password.
      </p>
      <div>
        <Label>Token id</Label>
        <input
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
          placeholder="root@pam!nexus"
          className={cn(inputCls, 'font-mono')}
          spellCheck={false}
          autoFocus
        />
        <Hint>Format: <code>user@realm!tokenname</code></Hint>
        {!tokenIdValid && tokenId.length > 0 && (
          <Hint variant="error">Token id must be <code>user@realm!tokenname</code>.</Hint>
        )}
      </div>
      <div>
        <Label>Token secret</Label>
        <div className="relative">
          <input
            type={showSecret ? 'text' : 'password'}
            value={tokenSecret}
            onChange={(e) => setTokenSecret(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className={cn(inputCls, 'font-mono pr-10')}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            className="absolute inset-y-0 right-0 px-3 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <Hint>Stored locally on this Nexus host. Never returned to the browser after save.</Hint>
      </div>
    </div>
  );
}

function StepConfirm({
  name, id, endpoints, tokenId, error,
}: {
  name: string;
  id: string;
  endpoints: string[];
  tokenId: string;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="studio-card rounded-lg p-4 space-y-3">
        <div>
          <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest mb-1">Identity</div>
          <div className="text-sm text-[var(--color-fg)]">{name}</div>
          <div className="text-xs font-mono text-[var(--color-fg-subtle)]">{id}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest mb-1">Endpoints</div>
          <ul className="space-y-0.5">
            {endpoints.map((ep, i) => (
              <li key={i} className="text-xs font-mono text-[var(--color-fg-secondary)]">
                <span className="text-[var(--color-fg-subtle)] mr-2">#{i + 1}</span>
                {ep}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest mb-1">Token</div>
          <div className="text-xs font-mono text-[var(--color-fg-secondary)]">{tokenId}</div>
          <div className="text-xs text-[var(--color-fg-faint)]">secret hidden</div>
        </div>
      </div>
      <p className="text-xs text-[var(--color-fg-subtle)]">
        We&apos;ll probe after save; the row will turn red if the endpoint is unreachable.
      </p>
      {error && (
        <div className="flex items-start gap-2 p-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 rounded-lg text-sm">
          <X className="w-4 h-4 text-[var(--color-err)] mt-0.5 shrink-0" />
          <div className="text-[var(--color-err)]">{error}</div>
        </div>
      )}
    </div>
  );
}

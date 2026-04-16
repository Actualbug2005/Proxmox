'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Code2,
  Play,
  AlertCircle,
  Clock,
  X,
  ExternalLink,
  BookOpen,
  Loader2,
  Server,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { readCsrfCookie } from '@/lib/proxmox-client';
import { useClusterResources } from '@/hooks/use-cluster';
import type {
  CommunityScript,
  ScriptCategory,
  ScriptManifest,
  ScriptOption,
} from '@/lib/community-scripts';
import type { GroupedEnvelope } from '@/app/api/scripts/route';

// ─── Typed fetch helpers ─────────────────────────────────────────────────────

/**
 * Structured error from our /api/scripts routes. Matches the JSON body
 * shape the route produces on non-2xx, so the UI can render specific
 * messaging rather than a generic "fetch failed".
 */
interface ApiError {
  status: number;
  error: string;
  kind?: 'timeout' | 'network' | 'http' | 'parse' | 'empty';
  detail?: string;
  upstreamStatus?: number | null;
  upstreamUrl?: string;
}

class ScriptsApiError extends Error implements ApiError {
  status: number;
  error: string;
  kind?: ApiError['kind'];
  detail?: string;
  upstreamStatus?: number | null;
  upstreamUrl?: string;

  constructor(body: ApiError) {
    super(body.detail ?? body.error);
    this.name = 'ScriptsApiError';
    this.status = body.status;
    this.error = body.error;
    this.kind = body.kind;
    this.detail = body.detail;
    this.upstreamStatus = body.upstreamStatus;
    this.upstreamUrl = body.upstreamUrl;
  }
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    // Routes always return JSON error bodies; if the body is malformed we
    // still want a typed error rather than crashing on res.json().
    let body: Partial<ApiError> = {};
    try { body = (await res.json()) as Partial<ApiError>; } catch { /* ignore */ }
    throw new ScriptsApiError({
      status: res.status,
      error: body.error ?? `HTTP ${res.status}`,
      kind: body.kind,
      detail: body.detail,
      upstreamStatus: body.upstreamStatus ?? null,
      upstreamUrl: body.upstreamUrl,
    });
  }
  return (await res.json()) as T;
}

// ─── Error renderer ──────────────────────────────────────────────────────────

function humanizeError(err: unknown): { title: string; message: string; icon: 'timeout' | 'network' } {
  if (err instanceof ScriptsApiError) {
    if (err.kind === 'timeout' || err.status === 504) {
      return {
        title: 'Upstream repository is taking too long',
        message:
          'GitHub did not respond in time. The community-scripts catalogue is usually available within a few seconds — try again in a moment, or check https://www.githubstatus.com.',
        icon: 'timeout',
      };
    }
    if (err.kind === 'http' && err.upstreamStatus === 403) {
      return {
        title: 'GitHub rate limit reached',
        message: 'The raw.githubusercontent.com endpoint returned 403. Unauthenticated requests are throttled — wait a minute and retry.',
        icon: 'network',
      };
    }
    if (err.kind === 'empty') {
      return {
        title: 'Upstream returned no scripts',
        message: 'The repository responded but the index was empty. This usually indicates a temporary upstream issue.',
        icon: 'network',
      };
    }
    return {
      title: 'Failed to load community scripts',
      message: err.detail ?? err.error,
      icon: 'network',
    };
  }
  return { title: 'Failed to load community scripts', message: String(err), icon: 'network' };
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ScriptCardSkeleton() {
  return (
    <div className="env-glass-card rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-4 w-32 rounded bg-zinc-800/50 animate-pulse" />
          <div className="h-3 w-48 rounded bg-zinc-800/50 animate-pulse" />
          <div className="h-3 w-40 rounded bg-zinc-800/50 animate-pulse" />
        </div>
        <div className="h-7 w-16 rounded bg-zinc-800/50 animate-pulse shrink-0" />
      </div>
    </div>
  );
}

// ─── ScriptCard ──────────────────────────────────────────────────────────────

function ScriptCard({
  script,
  onOpen,
}: {
  script: CommunityScript;
  onOpen: (s: CommunityScript) => void;
}) {
  const typeVariant: Record<CommunityScript['type'], 'info' | 'warning' | 'outline' | 'success'> = {
    ct: 'info',
    vm: 'warning',
    misc: 'outline',
    addon: 'success',
  };

  return (
    <button
      onClick={() => onOpen(script)}
      className="group text-left w-full env-glass-card rounded-lg p-4
                 transition hover:border-white/[0.14]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-medium text-zinc-100 truncate">{script.name}</h3>
            <Badge variant={typeVariant[script.type]}>{script.type.toUpperCase()}</Badge>
          </div>
          {script.description && (
            <p className="text-xs text-zinc-500 line-clamp-2">{script.description}</p>
          )}
          {script.author && (
            <p className="text-[11px] uppercase tracking-widest text-zinc-600 mt-1.5">
              by {script.author}
            </p>
          )}
        </div>
        <div className="shrink-0">
          <span
            className="flex items-center gap-1 px-2.5 py-1 bg-white/5 group-hover:bg-white/10
                       text-indigo-400 text-xs rounded-md transition"
          >
            <Play className="w-3 h-3" />
            Configure
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── ScriptDetailDialog ──────────────────────────────────────────────────────

type FieldValue = string | number | boolean;

interface FieldState {
  value: FieldValue;
  touched: boolean;
}

function defaultForOption(opt: ScriptOption): FieldValue {
  if (opt.default !== undefined) return opt.default;
  switch (opt.type) {
    case 'boolean': return false;
    case 'number': return 0;
    default: return '';
  }
}

function validate(opt: ScriptOption, value: FieldValue): string | null {
  if (opt.required) {
    if (opt.type === 'boolean') {
      // a required boolean must be true — that's the conventional meaning
      if (value !== true) return `${opt.label} must be enabled`;
    } else if (value === '' || value === null || value === undefined) {
      return `${opt.label} is required`;
    }
  }
  if (opt.type === 'number' && value !== '' && Number.isNaN(Number(value))) {
    return `${opt.label} must be a number`;
  }
  if (opt.type === 'select' && value !== '' && opt.choices && !opt.choices.includes(String(value))) {
    return `${opt.label} must be one of: ${opt.choices.join(', ')}`;
  }
  return null;
}

function ScriptDetailDialog({
  script,
  onClose,
}: {
  script: CommunityScript;
  onClose: () => void;
}) {
  const { data: manifest, isLoading, error } = useQuery<ScriptManifest, ScriptsApiError>({
    queryKey: ['community-scripts', 'manifest', script.slug],
    queryFn: () => getJSON<ScriptManifest>(`/api/scripts/${encodeURIComponent(script.slug)}`),
    staleTime: 60 * 60 * 1000,
  });

  // Cluster nodes for the target-node dropdown.
  const { data: resources } = useClusterResources();
  const nodes = useMemo(
    () => (resources ?? []).filter((r) => r.type === 'node' && r.status === 'online'),
    [resources],
  );
  const [selectedNode, setSelectedNode] = useState('');

  // Auto-select first online node once the list arrives.
  if (nodes.length > 0 && !selectedNode) {
    setSelectedNode(nodes[0].node ?? nodes[0].id);
  }

  // Form state keyed by option.name. Initialised once per manifest arrival.
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [initialised, setInitialised] = useState<string | null>(null);

  // Execution state.
  const [isExecuting, setIsExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [execSuccess, setExecSuccess] = useState<{ upid: string } | null>(null);

  // Initialise form state when the manifest first arrives.
  if (manifest && initialised !== manifest.slug) {
    const next: Record<string, FieldState> = {};
    for (const opt of manifest.options ?? []) {
      next[opt.name] = { value: defaultForOption(opt), touched: false };
    }
    setFields(next);
    setInitialised(manifest.slug);
  }

  const errors = useMemo<Record<string, string | null>>(() => {
    if (!manifest) return {};
    const out: Record<string, string | null> = {};
    for (const opt of manifest.options ?? []) {
      const state = fields[opt.name];
      out[opt.name] = state ? validate(opt, state.value) : null;
    }
    return out;
  }, [manifest, fields]);

  const hasErrors = Object.values(errors).some((e) => e !== null);

  function updateField(name: string, value: FieldValue) {
    setFields((prev) => ({ ...prev, [name]: { value, touched: true } }));
  }

  async function handleRun() {
    if (!manifest || !selectedNode || hasErrors) return;

    setIsExecuting(true);
    setExecError(null);

    try {
      const csrf = readCsrfCookie();
      const res = await fetch('/api/scripts/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
        body: JSON.stringify({
          node: selectedNode,
          scriptUrl: manifest.scriptUrl,
          scriptName: manifest.name,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { upid?: string };
      setExecSuccess({ upid: data.upid ?? '' });
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4
                 animate-modal-overlay"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800/60 rounded-lg w-full max-w-lg max-h-[85vh]
                   overflow-hidden flex flex-col animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-800/60">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-50 truncate">{script.name}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{script.slug}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-zinc-500 hover:text-zinc-200 rounded-md
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading && (
            <div className="space-y-3">
              <div className="h-4 w-2/3 rounded bg-zinc-800/50 animate-pulse" />
              <div className="h-3 w-full rounded bg-zinc-800/50 animate-pulse" />
              <div className="h-3 w-5/6 rounded bg-zinc-800/50 animate-pulse" />
              <div className="h-9 w-full rounded bg-zinc-800/50 animate-pulse" />
            </div>
          )}

          {error && <DialogError err={error} />}

          {/* Success state */}
          {execSuccess && (
            <div className="text-center py-4 space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-sm font-medium text-emerald-400">Script started!</p>
              {execSuccess.upid && (
                <p className="text-xs text-zinc-500 font-mono break-all">UPID: {execSuccess.upid}</p>
              )}
              <p className="text-xs text-zinc-500">Check the Tasks panel for progress.</p>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
              >
                Close
              </button>
            </div>
          )}

          {manifest && !execSuccess && (
            <>
              {manifest.description && (
                <p className="text-sm text-zinc-300 leading-relaxed">{manifest.description}</p>
              )}

              {/* Manifest meta strip */}
              <div className="flex flex-wrap gap-3 text-xs">
                <Badge variant="info">{manifest.type.toUpperCase()}</Badge>
                {manifest.category && <Badge variant="outline">{manifest.category}</Badge>}
                {manifest.updateable && <Badge variant="success">Updateable</Badge>}
                {manifest.website && (
                  <a
                    href={manifest.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 rounded"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Website
                  </a>
                )}
                {manifest.documentation && (
                  <a
                    href={manifest.documentation}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 rounded"
                  >
                    <BookOpen className="w-3 h-3" />
                    Docs
                  </a>
                )}
              </div>

              {/* Target node selector */}
              <div>
                <label htmlFor="target-node" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Target Node
                  <span className="ml-1 text-indigo-400" aria-hidden>*</span>
                </label>
                <div className="relative">
                  <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <select
                    id="target-node"
                    value={selectedNode}
                    onChange={(e) => setSelectedNode(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg pl-9 pr-8 py-1.5
                               text-sm text-zinc-100 appearance-none
                               focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:border-zinc-300"
                  >
                    {nodes.length === 0 && <option value="">No nodes online</option>}
                    {nodes.map((n) => (
                      <option key={n.id} value={n.node ?? n.id}>
                        {n.node ?? n.id}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Resource hints */}
              {manifest.resources && (
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950 p-3">
                  {manifest.resources.cpu !== undefined && (
                    <ResourceStat label="CPU" value={`${manifest.resources.cpu} cores`} />
                  )}
                  {manifest.resources.ram !== undefined && (
                    <ResourceStat label="RAM" value={`${manifest.resources.ram} MB`} />
                  )}
                  {manifest.resources.hdd && (
                    <ResourceStat label="Disk" value={manifest.resources.hdd} />
                  )}
                </div>
              )}

              {/* Default credentials warning */}
              {manifest.default_credentials && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-[11px] uppercase tracking-widest text-amber-400 mb-1">
                    Default credentials
                  </p>
                  <p className="text-sm tabular font-mono text-amber-200">
                    {manifest.default_credentials.username ?? 'N/A'} /{' '}
                    {manifest.default_credentials.password ?? 'N/A'}
                  </p>
                </div>
              )}

              {/* Options form */}
              {manifest.options && manifest.options.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-[11px] uppercase tracking-widest text-zinc-500">Options</h3>
                  {manifest.options.map((opt) => (
                    <OptionField
                      key={opt.name}
                      option={opt}
                      state={fields[opt.name]}
                      error={errors[opt.name]}
                      onChange={(v) => updateField(opt.name, v)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">
                  This script accepts no configuration options — defaults will be used.
                </p>
              )}

              {/* Notes */}
              {manifest.notes && manifest.notes.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-[11px] uppercase tracking-widest text-zinc-500">Notes</h3>
                  <ul className="space-y-1">
                    {manifest.notes.map((n, i) => (
                      <li key={i} className="flex gap-2 text-xs text-zinc-400">
                        <span className="text-indigo-400 shrink-0">•</span>
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!execSuccess && (
          <div className="px-5 py-3 border-t border-zinc-800/60 bg-zinc-950 space-y-3">
            {/* Execution error alert */}
            {execError && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-sm">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-400">{execError}</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={isExecuting}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50
                           text-zinc-200 text-sm rounded-lg transition
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={handleRun}
                disabled={hasErrors || !manifest || isExecuting || !selectedNode}
                title={
                  hasErrors ? 'Fix validation errors first'
                    : !selectedNode ? 'Select a target node'
                    : undefined
                }
                className="px-3 py-1.5 bg-zinc-100 hover:bg-white disabled:bg-zinc-100/40
                           disabled:cursor-not-allowed text-white text-sm rounded-lg transition
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300
                           flex items-center gap-1.5"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Executing…
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Run
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="text-sm tabular font-mono text-zinc-200 mt-0.5">{value}</p>
    </div>
  );
}

function DialogError({ err }: { err: ScriptsApiError }) {
  const humanised = humanizeError(err);
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10">
      {humanised.icon === 'timeout' ? (
        <Clock className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-red-300">{humanised.title}</p>
        <p className="text-xs text-red-300/80 mt-0.5">{humanised.message}</p>
      </div>
    </div>
  );
}

// ─── OptionField (dynamic form renderer) ────────────────────────────────────

function OptionField({
  option,
  state,
  error,
  onChange,
}: {
  option: ScriptOption;
  state: FieldState | undefined;
  error: string | null;
  onChange: (v: FieldValue) => void;
}) {
  const inputId = `opt-${option.name}`;
  const value = state?.value ?? defaultForOption(option);
  const touched = state?.touched ?? false;
  const showError = touched && error;

  const inputBase =
    'w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-1.5 text-sm text-zinc-100 ' +
    'placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:border-zinc-300';

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={inputId} className="text-xs font-medium text-zinc-300">
          {option.label}
          {option.required && <span className="ml-1 text-indigo-400" aria-hidden>*</span>}
        </label>
        <span className="text-[11px] text-zinc-600 font-mono">{option.type}</span>
      </div>

      {option.type === 'boolean' ? (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-zinc-400
                       focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
          {option.description ?? 'Enabled'}
        </label>
      ) : option.type === 'select' && option.choices ? (
        <select
          id={inputId}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={inputBase}
        >
          {!option.required && <option value="">—</option>}
          {option.choices.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      ) : option.type === 'password' ? (
        <input
          id={inputId}
          type="password"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={option.required}
          className={inputBase}
          autoComplete="new-password"
        />
      ) : option.type === 'number' ? (
        <input
          id={inputId}
          type="number"
          value={value === '' ? '' : Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          required={option.required}
          className={inputBase}
        />
      ) : (
        <input
          id={inputId}
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={option.required}
          className={inputBase}
        />
      )}

      {option.description && option.type !== 'boolean' && (
        <p className="text-[11px] text-zinc-500 mt-1">{option.description}</p>
      )}
      {showError && (
        <p className="text-[11px] text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

const ALL_CATEGORY = '__all__';

export default function ScriptsPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORY);
  const [selected, setSelected] = useState<CommunityScript | null>(null);

  const { data, isLoading, error } = useQuery<GroupedEnvelope, ScriptsApiError>({
    queryKey: ['community-scripts', 'grouped'],
    queryFn: () => getJSON<GroupedEnvelope>('/api/scripts?grouped=1'),
    staleTime: 60 * 60 * 1000,
  });

  const categories = data?.categories ?? [];

  // Derive the list of scripts in the active category (All = flatten).
  const visible = useMemo<CommunityScript[]>(() => {
    const source: CommunityScript[] =
      activeCategory === ALL_CATEGORY
        ? categories.flatMap((c) => c.scripts)
        : categories.find((c) => c.slug === activeCategory)?.scripts ?? [];

    if (!search) return source;
    const q = search.toLowerCase();
    return source.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q),
    );
  }, [categories, activeCategory, search]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-white/5 text-indigo-400 flex items-center justify-center">
          <Code2 className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Community Scripts</h1>
          <p className="text-sm text-zinc-500">
            {data
              ? `${data.meta.count} scripts across ${data.meta.categoryCount} categories · sourced from ${data.meta.source}`
              : 'Loading catalogue from community-scripts/ProxmoxVE…'}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search scripts by name, slug, or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800/60 rounded-lg
                     text-sm text-zinc-100 placeholder-zinc-600
                     focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:border-zinc-300"
        />
      </div>

      {/* Category tab rail */}
      <CategoryTabRail
        categories={categories}
        active={activeCategory}
        onChange={setActiveCategory}
        loading={isLoading}
      />

      {/* Error */}
      {error && <TopLevelError err={error} />}

      {/* Grid (skeleton during load, cards once ready) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {isLoading
          ? Array.from({ length: 12 }).map((_, i) => <ScriptCardSkeleton key={i} />)
          : visible.map((s) => (
              <ScriptCard key={s.slug} script={s} onOpen={setSelected} />
            ))}
      </div>

      {/* Empty state (after load, no matches) */}
      {!isLoading && !error && visible.length === 0 && (
        <div className="env-glass-card rounded-lg p-8 text-center">
          <Code2 className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
          <p className="text-sm text-zinc-400">No scripts match the current filters.</p>
        </div>
      )}

      {/* Detail dialog */}
      {selected && (
        <ScriptDetailDialog script={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ─── CategoryTabRail ────────────────────────────────────────────────────────

function CategoryTabRail({
  categories,
  active,
  onChange,
  loading,
}: {
  categories: ScriptCategory[];
  active: string;
  onChange: (slug: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-7 w-20 rounded-md bg-zinc-800/50 animate-pulse shrink-0" />
        ))}
      </div>
    );
  }

  const tabClass = (on: boolean) =>
    cn(
      'shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
      on
        ? 'bg-zinc-800 text-zinc-100 ring-1 ring-inset ring-zinc-700'
        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
    );

  const totalCount = categories.reduce((n, c) => n + c.scripts.length, 0);

  return (
    <div
      role="tablist"
      aria-label="Script categories"
      className="flex gap-1 overflow-x-auto pb-1 border-b border-zinc-800/60"
    >
      <button
        role="tab"
        aria-selected={active === ALL_CATEGORY}
        onClick={() => onChange(ALL_CATEGORY)}
        className={tabClass(active === ALL_CATEGORY)}
      >
        All <span className="ml-1 tabular font-mono text-zinc-500">{totalCount}</span>
      </button>
      {categories.map((c) => (
        <button
          key={c.slug}
          role="tab"
          aria-selected={active === c.slug}
          onClick={() => onChange(c.slug)}
          className={tabClass(active === c.slug)}
        >
          {c.name}
          <span className="ml-1 tabular font-mono text-zinc-500">{c.scripts.length}</span>
        </button>
      ))}
    </div>
  );
}

// ─── TopLevelError ──────────────────────────────────────────────────────────

function TopLevelError({ err }: { err: ScriptsApiError }) {
  const humanised = humanizeError(err);
  const Icon = humanised.icon === 'timeout' ? Clock : AlertCircle;
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
      <Icon className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-300">{humanised.title}</p>
        <p className="text-xs text-red-300/80 mt-0.5">{humanised.message}</p>
        {err.upstreamUrl && (
          <p className="text-[11px] text-red-300/60 mt-1 font-mono break-all">
            {err.upstreamUrl}
            {err.upstreamStatus ? ` · HTTP ${err.upstreamStatus}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

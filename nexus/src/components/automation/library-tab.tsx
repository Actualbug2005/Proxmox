'use client';

/**
 * Community Scripts tab body.
 *
 * Two-pane layout, modelled on community-scripts.github.io/ProxmoxVE:
 *   - Left rail: search + category tree + script list (sticky, scrollable).
 *   - Right pane: detail of the currently-selected script — install method
 *     picker, resources, credentials, notes, curl command, and the Run
 *     action wired to POST /api/scripts/run.
 *
 * Upstream data comes from the PocketBase-backed /api/scripts(+?grouped=1)
 * endpoint; the detail pane hits /api/scripts/[slug] lazily when a script is
 * picked so the initial page payload stays small (just the index).
 *
 * Extracted from `src/app/(app)/scripts/page.tsx` so the body can be hosted
 * inside the /dashboard/automation tabbed shell. The /scripts route keeps
 * the page-level chrome (outer height container + header bar).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Code2,
  Play,
  AlertCircle,
  AlertTriangle,
  Clock,
  BookOpen,
  Loader2,
  Server,
  Copy,
  Check,
  GitBranch,
  Info,
  ChevronDown,
  ChevronRight,
  Package,
  Cpu,
  HardDrive,
  MemoryStick,
  Globe,
  CheckCircle2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useClusterResources, useDefaultNode } from '@/hooks/use-cluster';
import { useStartScriptJob } from '@/hooks/use-script-jobs';
import { ScheduleJobEditor } from '@/components/scripts/schedule-job-editor';
import { ScriptLogo, TYPE_VARIANT } from '@/components/scripts/script-logo';
import { ScriptsApiError, getJSON, humanizeError } from '@/lib/scripts-api';
import type {
  CommunityScript,
  InstallMethod,
  ScriptCategory,
  ScriptManifest,
  ScriptNote,
} from '@/lib/community-scripts';
import type { GroupedEnvelope } from '@/app/api/scripts/route';

// ─── Sidebar (category tree) ─────────────────────────────────────────────────

function Sidebar({
  categories,
  search,
  onSearchChange,
  selectedSlug,
  onSelect,
  loading,
  error,
  totalCount,
}: {
  categories: ScriptCategory[];
  search: string;
  onSearchChange: (q: string) => void;
  selectedSlug: string | null;
  onSelect: (s: CommunityScript) => void;
  loading: boolean;
  error: ScriptsApiError | null;
  totalCount: number;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Filter scripts by the active query. When a query is set, we auto-expand
  // every category that still has a match so users see results without
  // having to fumble through collapsed sections.
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return categories;
    return categories
      .map((c) => ({
        ...c,
        scripts: c.scripts.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.slug.toLowerCase().includes(q) ||
            (s.description?.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((c) => c.scripts.length > 0);
  }, [categories, q]);

  const visibleTotal = useMemo(
    () => filtered.reduce((n, c) => n + c.scripts.length, 0),
    [filtered],
  );

  function toggle(slug: string) {
    setExpanded((prev) => ({ ...prev, [slug]: !(prev[slug] ?? false) }));
  }

  return (
    <aside className="flex flex-col min-h-0 w-full lg:w-80 lg:shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-canvas)]">
      <div className="p-3 border-b border-[var(--color-border-subtle)] space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)]" />
          <input
            type="text"
            placeholder="Search scripts…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg
                       text-sm text-[var(--color-fg)] placeholder-zinc-600
                       focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:border-zinc-300"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">
          {loading
            ? 'Loading…'
            : q
              ? `${visibleTotal} of ${totalCount} match`
              : `${totalCount} scripts · ${categories.length} categories`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {error && (
          <div className="p-3">
            <SidebarError err={error} />
          </div>
        )}
        {loading && !error && (
          <ul className="p-2 space-y-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <li
                key={i}
                className="h-7 rounded bg-zinc-900/70 animate-pulse"
                style={{ width: `${60 + (i * 13) % 35}%` }}
              />
            ))}
          </ul>
        )}
        {!loading && !error && filtered.length === 0 && (
          <p className="p-4 text-xs text-[var(--color-fg-subtle)] italic">No scripts match this query.</p>
        )}
        {!loading && !error && filtered.map((cat) => {
          // When searching, keep everything expanded; otherwise respect
          // the user's per-category toggle state (default: collapsed).
          const open = q ? true : (expanded[cat.slug] ?? false);
          return (
            <div key={cat.slug} className="border-b border-zinc-900/60 last:border-b-0">
              <button
                onClick={() => toggle(cat.slug)}
                disabled={Boolean(q)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left',
                  'text-xs font-medium text-[var(--color-fg-secondary)] hover:bg-zinc-900/60',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
                  q && 'cursor-default',
                )}
              >
                {open ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--color-fg-subtle)] shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--color-fg-subtle)] shrink-0" />
                )}
                <span className="truncate flex-1">{cat.name}</span>
                <span className="tabular font-mono text-[11px] text-[var(--color-fg-subtle)]">{cat.scripts.length}</span>
              </button>
              {open && (
                <ul className="pb-1">
                  {cat.scripts.map((s) => {
                    const selected = selectedSlug === s.slug;
                    return (
                      <li key={s.slug}>
                        <button
                          onClick={() => onSelect(s)}
                          className={cn(
                            'w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left text-xs',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
                            selected
                              ? 'bg-indigo-500/10 text-indigo-200 border-l-2 border-indigo-400 pl-[30px]'
                              : 'text-[var(--color-fg-muted)] hover:bg-zinc-900/60 hover:text-[var(--color-fg-secondary)]',
                          )}
                        >
                          <ScriptLogo script={s} size={18} />
                          <span className="truncate flex-1">{s.name}</span>
                          <Badge variant={TYPE_VARIANT[s.type]} className="shrink-0 text-[9px] px-1 py-0">
                            {s.type.toUpperCase()}
                          </Badge>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function SidebarError({ err }: { err: ScriptsApiError }) {
  const h = humanizeError(err);
  const Icon = h.icon === 'timeout' ? Clock : AlertCircle;
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/10">
      <Icon className="w-4 h-4 text-[var(--color-err)] mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-[var(--color-err)]">{h.title}</p>
        <p className="text-[11px] text-[var(--color-err)]/80 mt-0.5 leading-relaxed">{h.message}</p>
      </div>
    </div>
  );
}

// ─── Detail pane ─────────────────────────────────────────────────────────────

function EmptyDetail() {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-lg bg-white/5 text-indigo-400 mb-4">
          <Code2 className="w-5 h-5" />
        </div>
        <h2 className="text-sm font-semibold text-[var(--color-fg-secondary)] mb-1">Pick a script</h2>
        <p className="text-xs text-[var(--color-fg-subtle)] leading-relaxed">
          Browse the categories on the left or search above. Each entry comes with install methods,
          resource requirements, and a one-click run button for any online node in your cluster.
        </p>
      </div>
    </div>
  );
}

function ScriptDetail({ script }: { script: CommunityScript }) {
  const { data: manifest, isLoading, error } = useQuery<ScriptManifest, ScriptsApiError>({
    queryKey: ['community-scripts', 'manifest', script.slug],
    queryFn: () => getJSON<ScriptManifest>(`/api/scripts/${encodeURIComponent(script.slug)}`),
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex-1 p-6 space-y-4">
        <div className="h-6 w-1/3 rounded bg-zinc-800/60 animate-pulse" />
        <div className="h-4 w-4/5 rounded bg-zinc-800/60 animate-pulse" />
        <div className="h-4 w-3/5 rounded bg-zinc-800/60 animate-pulse" />
        <div className="h-24 w-full rounded bg-zinc-800/40 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-6">
        <SidebarError err={error} />
      </div>
    );
  }

  if (!manifest) return <EmptyDetail />;

  return <ScriptDetailBody manifest={manifest} />;
}

function ScriptDetailBody({ manifest }: { manifest: ScriptManifest }) {
  const methods = manifest.install_methods ?? [];
  const defaultMethodIdx = Math.max(
    0,
    methods.findIndex((m) => m.type === 'default'),
  );
  const [methodIdx, setMethodIdx] = useState(defaultMethodIdx);
  const activeMethod: InstallMethod | undefined = methods[methodIdx];
  const scriptUrl = activeMethod?.scriptUrl ?? manifest.scriptUrl;

  // Run-state.
  const { data: clusterResources } = useClusterResources();
  const nodes = useMemo(
    () => (clusterResources ?? []).filter((r) => r.type === 'node' && r.status === 'online'),
    [clusterResources],
  );
  const defaultNode = useDefaultNode();
  // Explicit user choice; falls back through derivation (default node →
  // first online node) so we don't seed state from async inputs.
  const [selectedNode, setSelectedNode] = useState('');
  const fallbackNode = defaultNode && nodes.some((n) => (n.node ?? n.id) === defaultNode)
    ? defaultNode
    : nodes[0]?.node ?? nodes[0]?.id ?? '';
  const effectiveNode = selectedNode || fallbackNode;

  // Advanced config: caller-supplied env overrides. Empty strings are
  // treated as "use the script's default" and stripped before send.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [envInputs, setEnvInputs] = useState<Record<string, string>>({});
  function setEnv(key: string, value: string) {
    setEnvInputs((prev) => ({ ...prev, [key]: value }));
  }

  const startJob = useStartScriptJob();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  // The jobId the server returned for the most recent Run from this pane.
  // Kept locally so the "Started" banner shows until the user triggers a
  // new run; the bottom-right status bar takes over from there.
  const [justStartedId, setJustStartedId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`bash -c "$(curl -fsSL ${scriptUrl})"`);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1_500);
    } catch {
      setCopyState('idle');
    }
  }

  function handleRun() {
    if (!effectiveNode || startJob.isPending) return;
    // Strip empty overrides so the server doesn't receive "CT_ID=" lines
    // that override the community script's default with an empty string.
    const env = Object.fromEntries(
      Object.entries(envInputs).filter(([, v]) => v.trim() !== ''),
    );
    startJob.mutate(
      {
        node: effectiveNode,
        scriptUrl,
        scriptName: manifest.name,
        slug: manifest.slug,
        method: activeMethod?.type,
        env,
      },
      {
        onSuccess: (data) => {
          setJustStartedId(data.jobId);
          setEnvInputs({}); // Clear so the next run starts clean.
        },
      },
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Header */}
        <header className="flex items-start gap-4">
          <ScriptLogo script={manifest} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-[var(--color-fg)] truncate">{manifest.name}</h1>
              <Badge variant={TYPE_VARIANT[manifest.type]}>{manifest.type.toUpperCase()}</Badge>
              {manifest.updateable && <Badge variant="success">Updateable</Badge>}
              {manifest.privileged && <Badge variant="warning">Privileged</Badge>}
              {manifest.has_arm && <Badge variant="outline">ARM64</Badge>}
            </div>
            <p className="text-xs text-[var(--color-fg-subtle)] mt-1">
              <span className="font-mono">{manifest.slug}</span>
              {manifest.category && <> · {manifest.category}</>}
              {manifest.date_created && <> · created {manifest.date_created.slice(0, 10)}</>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {manifest.website && (
              <ExternalIconLink href={manifest.website} label="Website" icon={Globe} />
            )}
            {manifest.documentation && (
              <ExternalIconLink href={manifest.documentation} label="Docs" icon={BookOpen} />
            )}
            {manifest.github && (
              <ExternalIconLink
                href={`https://github.com/${manifest.github}`}
                label="GitHub"
                icon={GitBranch}
              />
            )}
          </div>
        </header>

        {manifest.description && (
          <p className="text-sm text-[var(--color-fg-secondary)] leading-relaxed">{manifest.description}</p>
        )}

        {/* Run execution card */}
        <section className="studio-card rounded-lg p-4 space-y-3">
          {methods.length > 1 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-2">Install method</h3>
              <div className="flex flex-wrap gap-1.5">
                {methods.map((m, i) => (
                  <button
                    key={m.type + i}
                    onClick={() => setMethodIdx(i)}
                    className={cn(
                      'px-2.5 py-1 text-xs rounded-md border transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
                      i === methodIdx
                        ? 'bg-indigo-500/15 border-indigo-400/40 text-indigo-200'
                        : 'bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]',
                    )}
                  >
                    {prettyMethodName(m.type)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeMethod && <ResourceGrid method={activeMethod} />}

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <NodePicker nodes={nodes} value={effectiveNode} onChange={setSelectedNode} />
            <button
              onClick={handleRun}
              disabled={startJob.isPending || !effectiveNode}
              className="h-9 px-4 rounded-lg bg-indigo-500 hover:bg-indigo-400
                         disabled:bg-indigo-500/40 disabled:cursor-not-allowed
                         text-white text-sm font-medium transition
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300
                         inline-flex items-center gap-1.5 shrink-0"
            >
              {startJob.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Run on node
                </>
              )}
            </button>
            <button
              onClick={() => setScheduleOpen(true)}
              disabled={!effectiveNode}
              className="h-9 px-4 rounded-lg bg-[var(--color-overlay)] hover:bg-zinc-700
                         disabled:bg-zinc-800/40 disabled:cursor-not-allowed
                         text-[var(--color-fg-secondary)] text-sm font-medium transition
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500
                         inline-flex items-center gap-1.5 shrink-0"
              title="Schedule this script to run on a cadence"
            >
              <Clock className="w-3.5 h-3.5" />
              Schedule
            </button>
          </div>

          {/* Advanced configuration (env overrides) */}
          <AdvancedConfigPanel
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((v) => !v)}
            values={envInputs}
            onChange={setEnv}
          />

          {/* Post-start banner — persists until the user edits inputs or
           * starts another job. Full log + abort live in the status bar. */}
          {justStartedId && !startJob.isPending && !startJob.isError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/10 text-xs">
              <CheckCircle2 className="w-4 h-4 text-[var(--color-ok)] mt-0.5 shrink-0" />
              <p className="text-emerald-200">
                Started on <span className="font-mono">{effectiveNode}</span>. Track progress in the
                <span className="font-medium"> bottom-right status bar</span> — it opens a live log
                when clicked.
              </p>
            </div>
          )}

          {startJob.isError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 text-xs">
              <AlertCircle className="w-4 h-4 text-[var(--color-err)] mt-0.5 shrink-0" />
              <p className="text-[var(--color-err)]">{startJob.error.message}</p>
            </div>
          )}
        </section>

        {/* Install command */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">Install command</h3>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 rounded"
            >
              {copyState === 'copied' ? (
                <>
                  <Check className="w-3 h-3 text-[var(--color-ok)]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy
                </>
              )}
            </button>
          </div>
          <pre className="bg-[var(--color-canvas)] border border-[var(--color-border-subtle)] rounded-lg p-3 overflow-x-auto
                          text-xs text-[var(--color-fg-secondary)] font-mono whitespace-pre-wrap break-all">
{`bash -c "$(curl -fsSL ${scriptUrl})"`}
          </pre>
        </section>

        {/* Default credentials */}
        {manifest.default_credentials &&
          (manifest.default_credentials.username || manifest.default_credentials.password) && (
            <section className="rounded-lg border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-3">
              <p className="text-[11px] uppercase tracking-widest text-[var(--color-warn)] mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Default credentials
              </p>
              <p className="text-sm tabular font-mono text-amber-100">
                {manifest.default_credentials.username ?? '—'} /{' '}
                {manifest.default_credentials.password ?? '—'}
              </p>
              <p className="text-[11px] text-amber-200/70 mt-1">
                Change these immediately after the first login.
              </p>
            </section>
          )}

        {/* Service access */}
        {manifest.port && (
          <section className="rounded-lg border border-[var(--color-border-subtle)] p-3">
            <p className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-1">Web UI</p>
            <p className="text-sm text-[var(--color-fg-secondary)]">
              Reachable on port <span className="font-mono text-indigo-300">{manifest.port}</span>
              {' '}after install (e.g. <span className="font-mono">http://&lt;ip&gt;:{manifest.port}</span>).
            </p>
          </section>
        )}

        {/* Notes */}
        {manifest.notes && manifest.notes.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">Notes</h3>
            <ul className="space-y-2">
              {manifest.notes.map((n, i) => (
                <li key={i}>
                  <NoteCallout note={n} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {scheduleOpen && (
        <ScheduleJobEditor
          onClose={() => setScheduleOpen(false)}
          preset={{
            slug: manifest.slug,
            scriptUrl,
            scriptName: manifest.name,
            method: activeMethod?.type,
            node: effectiveNode || undefined,
          }}
        />
      )}
    </div>
  );
}

function ExternalIconLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Globe;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] hover:bg-white/5
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
    >
      <Icon className="w-4 h-4" />
    </a>
  );
}

function prettyMethodName(type: string): string {
  if (!type) return 'Default';
  if (type === 'default') return 'Default';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function ResourceGrid({ method }: { method: InstallMethod }) {
  const { resources } = method;
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-2">Resources</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat icon={Cpu} label="CPU" value={`${resources.cpu} ${resources.cpu === 1 ? 'core' : 'cores'}`} />
        <Stat icon={MemoryStick} label="RAM" value={`${resources.ram} MB`} />
        <Stat icon={HardDrive} label="Disk" value={`${resources.hdd} GB`} />
        <Stat
          icon={Package}
          label="OS"
          value={`${resources.os}${resources.version ? ` ${resources.version}` : ''}`}
        />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-canvas)] p-2.5">
      <div className="flex items-center gap-1.5 text-[var(--color-fg-subtle)]">
        <Icon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-sm text-[var(--color-fg-secondary)] mt-0.5 tabular font-mono truncate">{value}</p>
    </div>
  );
}

function NodePicker({
  nodes,
  value,
  onChange,
}: {
  nodes: ReadonlyArray<{ id: string; node?: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      <label htmlFor="target-node" className="block text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-1">
        Target node
      </label>
      <div className="relative">
        <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)]" />
        <select
          id="target-node"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg pl-9 pr-8
                     text-sm text-[var(--color-fg)] appearance-none
                     focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:border-zinc-300"
        >
          {nodes.length === 0 && <option value="">No nodes online</option>}
          {nodes.map((n) => (
            <option key={n.id} value={n.node ?? n.id}>
              {n.node ?? n.id}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)] pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Advanced configuration ─────────────────────────────────────────────────

/**
 * Env-override fields the UI exposes for community scripts. The names map
 * to common conventions used by community-scripts/ProxmoxVE — in particular
 * the `var_*` lowercase names used by the newer `build.func` templates AND
 * the uppercase legacy names (`HN`, `CT_ID`, `PW`) used by older scripts.
 *
 * Values are best-effort — individual scripts may ignore them (especially
 * the `VM` and `addon` types, which don't inherit the LXC build flow).
 * The helper text on each field reminds the user.
 *
 * The server re-validates every name and value against its own allow-list
 * + regex (see `sanitiseEnv` in lib/script-jobs.ts); anything not listed
 * here but accepted there is safe to add later without UI changes.
 */
const ADVANCED_FIELDS: {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  width: 'half' | 'full';
}[] = [
  // Names match `misc/build.func` in community-scripts/ProxmoxVE — the
  // build.func reads these as `${var_*:-<default>}`, so a blank field
  // falls back to the script's own default. See base_settings() / the
  // `var_*` references in that file for the authoritative list.
  { key: 'var_hostname', label: 'Hostname', placeholder: 'my-service', width: 'half' },
  { key: 'var_ctid', label: 'Container ID', placeholder: 'next free', width: 'half' },
  { key: 'var_cpu', label: 'CPU cores', placeholder: '1', width: 'half' },
  { key: 'var_ram', label: 'RAM (MB)', placeholder: '512', width: 'half' },
  { key: 'var_disk', label: 'Disk (GB)', placeholder: '2', width: 'half' },
  {
    key: 'var_container_storage',
    label: 'Storage pool',
    placeholder: 'local-lvm',
    width: 'half',
  },
  {
    key: 'var_pw',
    label: 'Root password',
    placeholder: 'leave empty for auto-generated',
    hint: 'Blank → script generates one. Fill only if you need a specific value; some scripts will reject empty.',
    width: 'full',
  },
];

function AdvancedConfigPanel({
  open,
  onToggle,
  values,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const count = Object.values(values).filter((v) => v.trim() !== '').length;
  return (
    <div className="border-t border-[var(--color-border-subtle)] pt-3">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]
                   hover:text-[var(--color-fg-secondary)]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 rounded"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced configuration
        {count > 0 && (
          <span className="ml-1 tabular font-mono text-indigo-300">({count} override{count === 1 ? '' : 's'})</span>
        )}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-[var(--color-fg-subtle)] leading-relaxed">
            These env vars are forwarded to the script. Individual scripts may ignore overrides —
            leave a field blank to accept the script&apos;s built-in default.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ADVANCED_FIELDS.map((f) => (
              <div key={f.key} className={f.width === 'full' ? 'col-span-2' : 'col-span-1'}>
                <label
                  htmlFor={`adv-${f.key}`}
                  className="block text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-1"
                >
                  {f.label}
                  <span className="ml-1 text-[var(--color-fg-faint)] font-mono normal-case tracking-normal">
                    {f.key}
                  </span>
                </label>
                <input
                  id={`adv-${f.key}`}
                  type={f.key === 'PW' ? 'password' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  autoComplete={f.key === 'PW' ? 'new-password' : 'off'}
                  className="w-full h-8 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-md px-2
                             text-xs text-[var(--color-fg)] placeholder-zinc-600
                             focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:border-zinc-300"
                />
                {f.hint && <p className="text-[10px] text-[var(--color-fg-faint)] mt-0.5 leading-snug">{f.hint}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NoteCallout({ note }: { note: ScriptNote }) {
  const styles: Record<ScriptNote['type'], { border: string; bg: string; text: string; icon: typeof Info }> = {
    info: {
      border: 'border-sky-500/30',
      bg: 'bg-sky-500/5',
      text: 'text-sky-100',
      icon: Info,
    },
    warning: {
      border: 'border-[var(--color-warn)]/30',
      bg: 'bg-[var(--color-warn)]/5',
      text: 'text-amber-100',
      icon: AlertTriangle,
    },
    danger: {
      border: 'border-[var(--color-err)]/30',
      bg: 'bg-[var(--color-err)]/5',
      text: 'text-red-100',
      icon: AlertCircle,
    },
  };
  const s = styles[note.type];
  const Icon = s.icon;
  return (
    <div className={cn('flex items-start gap-2 p-3 rounded-lg border', s.border, s.bg)}>
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', s.text)} />
      <p className={cn('text-xs leading-relaxed', s.text)}>{note.text}</p>
    </div>
  );
}

// ─── Tab body ────────────────────────────────────────────────────────────────

/**
 * Library tab body.
 *
 * Owns its own bounded-height flex-column contract: the inner two-pane relies
 * on `flex-1 min-h-0` which only works when an ancestor caps the height.
 * When hosted inside /dashboard/automation (which lays out its shell as a
 * normal `p-6 space-y-6` block), this wrapper is what makes the sticky
 * sidebar and the scrollable detail pane behave.
 *
 * The outer shell already renders an <h1>Automation</h1> and the tab bar —
 * we deliberately do NOT render a second <h1>Community Scripts</h1> here.
 * The catalogue meta line (count / category count / source) is preserved as
 * a small flex-shrink-0 status strip above the two-pane so load-bearing copy
 * isn't lost.
 *
 * The `calc(100dvh - spacing.56)` offset accounts for the outer top bar,
 * shell padding, shell header, tab bar, and `space-y-6` gaps between them.
 * The `-mt-4` tightens the visual gap above the two-pane since the shell's
 * `space-y-6` already contributes 1.5rem between the TabBar and this tab.
 */
export function LibraryTab() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CommunityScript | null>(null);

  const { data, isLoading, error } = useQuery<GroupedEnvelope, ScriptsApiError>({
    queryKey: ['community-scripts', 'grouped'],
    queryFn: () => getJSON<GroupedEnvelope>('/api/scripts?grouped=1'),
    staleTime: 60 * 60 * 1000,
  });

  const categories = data?.categories ?? [];
  const totalCount = data?.meta.count ?? 0;

  return (
    <div className="-mt-4 h-[calc(100dvh-theme(spacing.56))] flex flex-col">
      <div className="flex-shrink-0 px-1 pb-2 text-xs text-[var(--color-fg-subtle)]">
        {isLoading
          ? 'Loading catalogue from community-scripts.org…'
          : data
            ? `${totalCount} scripts · ${data.meta.categoryCount} categories · sourced from ${data.meta.source}`
            : 'Catalogue unavailable'}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row border border-[var(--color-border-subtle)] rounded-lg overflow-hidden">
        <Sidebar
          categories={categories}
          search={search}
          onSearchChange={setSearch}
          selectedSlug={selected?.slug ?? null}
          onSelect={setSelected}
          loading={isLoading}
          error={error ?? null}
          totalCount={totalCount}
        />
        {selected ? <ScriptDetail key={selected.slug} script={selected} /> : <EmptyDetail />}
      </div>
    </div>
  );
}

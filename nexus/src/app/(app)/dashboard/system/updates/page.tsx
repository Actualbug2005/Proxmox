'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { readCsrfCookie } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { Loader2, RefreshCw, Download, CheckCircle2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useUpdatePolicyMutation,
  useUpdatesHistory,
  useUpdatesPolicy,
} from '@/hooks/use-updates-policy';
import { SCHEDULE_PRESETS, type UpdatePolicyMode, type AutoInstallScope, type UpdateChannel } from '@/lib/updates/types';
import { nextFires } from '@/lib/cron-match';

interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  publishedAt: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
}

async function fetchVersion(): Promise<VersionInfo> {
  const res = await fetch('/api/system/version', { cache: 'no-store' });
  if (!res.ok) throw new Error(`version probe failed: ${res.status}`);
  return (await res.json()) as VersionInfo;
}

async function triggerUpdate(version?: string): Promise<{ installed: string; message: string }> {
  const csrf = readCsrfCookie();
  const res = await fetch('/api/system/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
    },
    body: JSON.stringify(version ? { version } : {}),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string; installed?: string; message?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `updater returned ${res.status}`);
  }
  return { installed: json.installed ?? '', message: json.message ?? '' };
}

export default function UpdatesPage() {
  const toast = useToast();
  const [pollingAfterUpdate, setPollingAfterUpdate] = useState(false);

  const {
    data: version,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<VersionInfo>({
    queryKey: ['system', 'version'],
    queryFn: fetchVersion,
    // Poll every 5s while waiting for the new version to show up post-update.
    refetchInterval: pollingAfterUpdate ? 5_000 : false,
  });

  // Stop polling once the current version matches the latest.
  if (pollingAfterUpdate && version && version.latest && version.current === version.latest) {
    setPollingAfterUpdate(false);
    toast.success('Nexus is now running the latest version', version.current);
  }

  const updateM = useMutation({
    mutationFn: () => triggerUpdate(),
    onSuccess: ({ message }) => {
      toast.success('Update scheduled', message);
      // Kick off polling — the version endpoint will report the new tag
      // ~10s after the service restart completes.
      setTimeout(() => setPollingAfterUpdate(true), 5_000);
    },
    onError: (err) => {
      toast.error('Update failed', err instanceof Error ? err.message : String(err));
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--color-fg-subtle)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!version) {
    return (
      <div className="studio-card p-6 text-sm text-[var(--color-fg-muted)]">
        Could not read version info. Is <code className="text-[var(--color-fg-secondary)]">/opt/nexus/current/VERSION</code> present?
      </div>
    );
  }

  const { current, latest, updateAvailable, publishedAt, releaseUrl, releaseNotes } = version;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">Updates</h1>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            Manage the Nexus release channel. Updates download from GitHub and
            swap atomically via the <code className="text-[var(--color-fg-muted)]">nexus-update</code> helper.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-white/5 px-3 py-2 text-sm text-[var(--color-fg-secondary)] hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          Check again
        </button>
      </header>

      <section className="studio-card p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">Installed</div>
            <div className="mt-1 font-mono text-2xl text-[var(--color-fg)]">{current}</div>
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">Latest</div>
            <div className="mt-1 font-mono text-2xl text-[var(--color-fg)]">
              {latest ?? <span className="text-[var(--color-fg-faint)]">unavailable</span>}
            </div>
            {publishedAt && (
              <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                Published {new Date(publishedAt).toLocaleString()}
              </div>
            )}
          </div>
          <div className="flex-shrink-0">
            {updateAvailable ? (
              <button
                type="button"
                onClick={() => updateM.mutate()}
                disabled={updateM.isPending || pollingAfterUpdate}
                className="inline-flex items-center gap-2 rounded-md bg-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
              >
                {updateM.isPending || pollingAfterUpdate ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {pollingAfterUpdate ? 'Waiting for restart…' : `Install ${latest}`}
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-md bg-white/5 px-4 py-2 text-sm text-[var(--color-fg-secondary)]">
                <CheckCircle2 className="h-4 w-4 text-indigo-400" />
                Up to date
              </div>
            )}
          </div>
        </div>
      </section>

      {releaseNotes && (
        <section className="studio-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-[var(--color-fg-secondary)]">
              Release notes — {latest}
            </h2>
            {releaseUrl && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]"
              >
                View on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="mt-3 text-sm leading-relaxed text-[var(--color-fg-secondary)]">
            {/* Security: no rehype-raw in the pipeline — react-markdown escapes
                raw HTML by default, so GitHub release bodies render text-only.
                Invariant locked by src/tests/security/markdown-pipeline.test.ts. */}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: (props) => <h1 className="mt-6 mb-2 text-base font-semibold text-[var(--color-fg)] first:mt-0" {...props} />,
                h2: (props) => <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-fg-secondary)] first:mt-0" {...props} />,
                h3: (props) => <h3 className="mt-4 mb-2 text-sm font-semibold text-[var(--color-fg-secondary)] first:mt-0" {...props} />,
                p: (props) => <p className="my-2 text-[var(--color-fg-secondary)]" {...props} />,
                ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-[var(--color-fg-faint)]" {...props} />,
                ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-[var(--color-fg-faint)]" {...props} />,
                li: (props) => <li className="text-[var(--color-fg-secondary)]" {...props} />,
                a: (props) => <a className="text-indigo-400 underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
                strong: (props) => <strong className="font-semibold text-[var(--color-fg)]" {...props} />,
                em: (props) => <em className="italic text-[var(--color-fg-secondary)]" {...props} />,
                code: ({ className, children, ...props }) => {
                  const isBlock = /\bhljs\b|^language-/.test(className ?? '');
                  return isBlock ? (
                    <code className="block w-full whitespace-pre overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-zinc-900/60 p-3 font-mono text-xs text-[var(--color-fg-secondary)]" {...props}>{children}</code>
                  ) : (
                    <code className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[0.8125rem] text-[var(--color-fg-secondary)]" {...props}>{children}</code>
                  );
                },
                pre: (props) => <pre className="my-3 overflow-x-auto" {...props} />,
                blockquote: (props) => <blockquote className="my-3 border-l-2 border-[var(--color-border-strong)] pl-3 text-[var(--color-fg-muted)] italic" {...props} />,
                hr: () => <hr className="my-4 border-[var(--color-border-subtle)]" />,
                table: (props) => <table className="my-3 w-full border-collapse text-xs" {...props} />,
                thead: (props) => <thead className="border-b border-[var(--color-border-subtle)] text-[var(--color-fg-muted)]" {...props} />,
                th: (props) => <th className="px-2 py-1.5 text-left font-medium" {...props} />,
                td: (props) => <td className="border-b border-zinc-800/40 px-2 py-1.5 text-[var(--color-fg-secondary)]" {...props} />,
              }}
            >
              {releaseNotes}
            </ReactMarkdown>
          </div>
        </section>
      )}

      {pollingAfterUpdate && (
        <div className="studio-card flex items-center gap-3 p-4 text-sm text-[var(--color-fg-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
          Service is restarting. This page will reconnect automatically once the new version is live (≈10 seconds).
        </div>
      )}

      <AutoUpdatePolicyCard />
      <AutoUpdateHistoryCard />
    </div>
  );
}

/**
 * Policy card — the "mixed mode" operator control. Off / notify / auto,
 * delta scope cap for auto-install, and a cron preset picker with a
 * chip-list preview of the next 5 fire times.
 */
function AutoUpdatePolicyCard() {
  const toast = useToast();
  const { data: policy, isLoading } = useUpdatesPolicy();
  const mutate = useUpdatePolicyMutation();

  // Presets: production / homelab map to known cron strings, custom
  // shows the raw field + preview. "Custom" is active whenever the
  // persisted cron doesn't equal either preset.
  const presetMatch = useMemo(() => {
    if (!policy) return 'custom';
    if (policy.cron === SCHEDULE_PRESETS.production.cron) return 'production';
    if (policy.cron === SCHEDULE_PRESETS.homelab.cron) return 'homelab';
    return 'custom';
  }, [policy]);
  const [customCron, setCustomCron] = useState<string>('');
  const activeCron = presetMatch === 'custom' ? customCron || policy?.cron || '' : policy?.cron || '';
  const previewFires = useMemo(() => nextFires(activeCron, 5), [activeCron]);

  if (isLoading || !policy) {
    return (
      <section className="studio-card flex items-center gap-3 p-6 text-sm text-[var(--color-fg-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading auto-update policy…
      </section>
    );
  }

  function apply(patch: Parameters<typeof mutate.mutate>[0]): void {
    mutate.mutate(patch, {
      onError: (err) => toast.error('Policy save failed', err.message),
    });
  }

  return (
    <section className="studio-card space-y-5 p-6">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-[var(--color-fg-secondary)]">
          Auto-update policy
        </h2>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          How Nexus handles new releases from GitHub. `Notify` (default) only emits
          a notification; `Auto` installs unattended within the delta cap and
          safety rails.
        </p>
      </div>

      {/* Mode */}
      <div>
        <p className="mb-2 text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">Mode</p>
        <div className="inline-flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
          {(['off', 'notify', 'auto'] as UpdatePolicyMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => apply({ mode: m })}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition',
                policy.mode === m
                  ? 'bg-zinc-100 text-zinc-900 shadow-sm'
                  : 'text-[var(--color-fg-muted)] hover:bg-white/[0.04] hover:text-[var(--color-fg)]',
              )}
              aria-pressed={policy.mode === m}
            >
              {m === 'off' ? 'Off' : m === 'notify' ? 'Notify only' : 'Auto-install'}
            </button>
          ))}
        </div>
      </div>

      {/* Delta scope — only meaningful when mode=auto */}
      {policy.mode === 'auto' && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">
            Unattended install scope
          </p>
          <div className="inline-flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {(['patch', 'minor', 'any'] as AutoInstallScope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => apply({ autoInstallScope: s })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition',
                  policy.autoInstallScope === s
                    ? 'bg-zinc-100 text-zinc-900 shadow-sm'
                    : 'text-[var(--color-fg-muted)] hover:bg-white/[0.04] hover:text-[var(--color-fg)]',
                )}
              >
                {s === 'patch'
                  ? 'Patch only (x.y.Z)'
                  : s === 'minor'
                    ? 'Patch + minor (x.Y.Z)'
                    : 'Any (X.Y.Z)'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--color-fg-subtle)]">
            Deltas larger than the cap still emit `nexus.update.available` so you can install by hand.
          </p>
        </div>
      )}

      {/* Channel */}
      {policy.mode !== 'off' && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">Channel</p>
          <div className="inline-flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {(['stable', 'prerelease'] as UpdateChannel[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => apply({ channel: c })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition',
                  policy.channel === c
                    ? 'bg-zinc-100 text-zinc-900 shadow-sm'
                    : 'text-[var(--color-fg-muted)] hover:bg-white/[0.04] hover:text-[var(--color-fg)]',
                )}
              >
                {c === 'stable' ? 'Stable releases' : 'Include pre-releases'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Schedule */}
      {policy.mode !== 'off' && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">
            Check schedule
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => apply({ cron: SCHEDULE_PRESETS.production.cron })}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs transition',
                presetMatch === 'production'
                  ? 'border-[var(--color-accent-border,rgba(255,255,255,0.5))] bg-white/[0.08] text-[var(--color-fg)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--color-fg-muted)] hover:bg-white/[0.06]',
              )}
            >
              {SCHEDULE_PRESETS.production.label}
            </button>
            <button
              type="button"
              onClick={() => apply({ cron: SCHEDULE_PRESETS.homelab.cron })}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs transition',
                presetMatch === 'homelab'
                  ? 'border-[var(--color-accent-border,rgba(255,255,255,0.5))] bg-white/[0.08] text-[var(--color-fg)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--color-fg-muted)] hover:bg-white/[0.06]',
              )}
            >
              {SCHEDULE_PRESETS.homelab.label}
            </button>
            <button
              type="button"
              onClick={() => setCustomCron(policy.cron)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs transition',
                presetMatch === 'custom'
                  ? 'border-[var(--color-accent-border,rgba(255,255,255,0.5))] bg-white/[0.08] text-[var(--color-fg)]'
                  : 'border-white/10 bg-white/[0.03] text-[var(--color-fg-muted)] hover:bg-white/[0.06]',
              )}
            >
              Custom
            </button>
          </div>

          {presetMatch === 'custom' && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                onBlur={() => customCron.trim() && apply({ cron: customCron.trim() })}
                placeholder="e.g. 0 9 * * mon"
                className="w-full max-w-xs rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-overlay)] px-3 py-1.5 font-mono text-xs text-[var(--color-fg-secondary)] focus:border-zinc-300/50 focus:outline-none"
              />
              <p className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                active → {policy.cron}
              </p>
            </div>
          )}

          {previewFires.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {previewFires.map((d) => (
                <li
                  key={d.getTime()}
                  title={d.toISOString()}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] tabular text-[var(--color-fg-secondary)]"
                >
                  {d.toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Recent checks table — last 20 entries sourced from `run-history.jsonl`
 * filtered to source=update. Survives process restarts; good for
 * "why didn't it upgrade overnight?" debugging the morning after.
 */
function AutoUpdateHistoryCard() {
  const { data: runs, isLoading } = useUpdatesHistory(20);

  return (
    <section className="studio-card space-y-3 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--color-fg-secondary)]">
          Recent checks
        </h2>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>
      {!isLoading && (!runs || runs.length === 0) && (
        <p className="text-xs text-[var(--color-fg-subtle)]">
          No checks recorded yet. History begins on the next tick that matches the cron schedule.
        </p>
      )}
      {runs && runs.length > 0 && (
        <div className="space-y-1">
          {runs.map((r) => (
            <div
              key={`${r.at}-${r.outcome}`}
              className="flex items-center gap-3 py-1 text-xs tabular text-[var(--color-fg-secondary)]"
            >
              <span
                className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                  r.outcome === 'success'
                    ? 'bg-[var(--color-ok)]'
                    : r.outcome === 'failed'
                      ? 'bg-[var(--color-err)]'
                      : 'bg-zinc-600',
                )}
                title={r.outcome}
              />
              <span className="w-44 shrink-0 text-[var(--color-fg-muted)]">
                {new Date(r.at).toLocaleString()}
              </span>
              <span className="w-20 shrink-0 text-[var(--color-fg-subtle)]">{r.outcome}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--color-fg-subtle)]">
                {r.note ?? r.error ?? ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

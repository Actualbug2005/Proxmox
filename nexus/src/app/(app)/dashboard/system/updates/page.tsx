'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { readCsrfCookie } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { Loader2, RefreshCw, Download, CheckCircle2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      <div className="flex items-center justify-center py-16 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!version) {
    return (
      <div className="studio-card p-6 text-sm text-zinc-400">
        Could not read version info. Is <code className="text-zinc-200">/opt/nexus/current/VERSION</code> present?
      </div>
    );
  }

  const { current, latest, updateAvailable, publishedAt, releaseUrl, releaseNotes } = version;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Updates</h1>
          <p className="text-sm text-zinc-500">
            Manage the Nexus release channel. Updates download from GitHub and
            swap atomically via the <code className="text-zinc-400">nexus-update</code> helper.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-800/60 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          Check again
        </button>
      </header>

      <section className="studio-card p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Installed</div>
            <div className="mt-1 font-mono text-2xl text-zinc-100">{current}</div>
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Latest</div>
            <div className="mt-1 font-mono text-2xl text-zinc-100">
              {latest ?? <span className="text-zinc-600">unavailable</span>}
            </div>
            {publishedAt && (
              <div className="mt-1 text-xs text-zinc-500">
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
              <div className="inline-flex items-center gap-2 rounded-md bg-white/5 px-4 py-2 text-sm text-zinc-300">
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
            <h2 className="text-sm font-semibold tracking-wide text-zinc-200">
              Release notes — {latest}
            </h2>
            {releaseUrl && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
              >
                View on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="mt-3 text-sm leading-relaxed text-zinc-300">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: (props) => <h1 className="mt-6 mb-2 text-base font-semibold text-zinc-100 first:mt-0" {...props} />,
                h2: (props) => <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-200 first:mt-0" {...props} />,
                h3: (props) => <h3 className="mt-4 mb-2 text-sm font-semibold text-zinc-200 first:mt-0" {...props} />,
                p: (props) => <p className="my-2 text-zinc-300" {...props} />,
                ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-zinc-600" {...props} />,
                ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-zinc-600" {...props} />,
                li: (props) => <li className="text-zinc-300" {...props} />,
                a: (props) => <a className="text-indigo-400 underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
                strong: (props) => <strong className="font-semibold text-zinc-100" {...props} />,
                em: (props) => <em className="italic text-zinc-200" {...props} />,
                code: ({ className, children, ...props }) => {
                  const isBlock = /\bhljs\b|^language-/.test(className ?? '');
                  return isBlock ? (
                    <code className="block w-full whitespace-pre overflow-x-auto rounded-md border border-zinc-800/60 bg-zinc-900/60 p-3 font-mono text-xs text-zinc-200" {...props}>{children}</code>
                  ) : (
                    <code className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[0.8125rem] text-zinc-200" {...props}>{children}</code>
                  );
                },
                pre: (props) => <pre className="my-3 overflow-x-auto" {...props} />,
                blockquote: (props) => <blockquote className="my-3 border-l-2 border-zinc-700 pl-3 text-zinc-400 italic" {...props} />,
                hr: () => <hr className="my-4 border-zinc-800/60" />,
                table: (props) => <table className="my-3 w-full border-collapse text-xs" {...props} />,
                thead: (props) => <thead className="border-b border-zinc-800/60 text-zinc-400" {...props} />,
                th: (props) => <th className="px-2 py-1.5 text-left font-medium" {...props} />,
                td: (props) => <td className="border-b border-zinc-800/40 px-2 py-1.5 text-zinc-300" {...props} />,
              }}
            >
              {releaseNotes}
            </ReactMarkdown>
          </div>
        </section>
      )}

      {pollingAfterUpdate && (
        <div className="studio-card flex items-center gap-3 p-4 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
          Service is restarting. This page will reconnect automatically once the new version is live (≈10 seconds).
        </div>
      )}
    </div>
  );
}

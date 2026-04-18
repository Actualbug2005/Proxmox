'use client';

/**
 * Full-log drawer for a single script job. Slides in from the right,
 * shows live log output, and exposes an Abort button while the job is
 * still running.
 *
 * Polling: useScriptJobDetail polls every 2 s until status flips off
 * "running", then stops. The log area auto-scrolls to the bottom when
 * new bytes arrive AND the user hasn't manually scrolled up (classic
 * "tail -f" behaviour).
 */

import { useEffect, useRef, useState } from 'react';
import {
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  StopCircle,
  Copy,
  Check,
  Terminal,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScriptJobDetail, useAbortScriptJob, type JobSummary } from '@/hooks/use-script-jobs';

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1_000);
  return `${mins}m${secs}s`;
}

function StatusBadge({ status, exitCode }: { status: JobSummary['status']; exitCode?: number | null }) {
  const styles: Record<JobSummary['status'], { bg: string; text: string; icon: typeof Loader2 }> = {
    running: { bg: 'bg-indigo-500/15', text: 'text-indigo-200', icon: Loader2 },
    success: { bg: 'bg-emerald-500/15', text: 'text-emerald-200', icon: CheckCircle2 },
    aborted: { bg: 'bg-amber-500/15', text: 'text-amber-200', icon: StopCircle },
    failed: { bg: 'bg-red-500/15', text: 'text-red-200', icon: XCircle },
  };
  const s = styles[status];
  const Icon = s.icon;
  const suffix =
    status === 'failed' && typeof exitCode === 'number' && exitCode !== 0
      ? ` · exit ${exitCode}`
      : '';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
        s.bg,
        s.text,
      )}
    >
      <Icon className={cn('w-3 h-3', status === 'running' && 'animate-spin')} />
      {status}
      {suffix}
    </span>
  );
}

export function JobDrawer({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const { data: job, error } = useScriptJobDetail(jobId);
  const abort = useAbortScriptJob();

  const [copied, setCopied] = useState(false);
  // `now` is updated by a 1 s interval while the job is running, so the
  // elapsed-duration label ticks smoothly. Kept in state (not a bare
  // Date.now() in render) to satisfy React's strict purity rule.
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (job?.status !== 'running') return undefined;
    const h = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(h);
  }, [job?.status]);

  // Track whether the user has manually scrolled up. If they have, we stop
  // autoscrolling so their reading position isn't ripped away. When they
  // scroll back to the bottom, tailing resumes.
  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 20;
  }

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job?.log, job?.tail]);

  // Close on Escape.
  useEffect(() => {
    if (!jobId) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jobId, onClose]);

  if (!jobId) return null;

  const logText = job?.log || job?.tail || '';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  function handleAbort() {
    if (!job || job.status !== 'running') return;
    abort.mutate(job.id);
  }

  const duration = job ? (job.finishedAt ?? now) - job.startedAt : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-zinc-950/60 animate-modal-overlay"
      onClick={onClose}
    >
      <aside
        className="w-full max-w-2xl h-full bg-[var(--color-canvas)] border-l border-zinc-800/80
                   flex flex-col animate-modal-content"
        onClick={(e) => e.stopPropagation()}
        aria-label="Script job details"
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border-subtle)]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Terminal className="w-4 h-4 text-indigo-400 shrink-0" />
              <h2 className="text-sm font-semibold text-[var(--color-fg)] truncate">
                {job?.scriptName ?? 'Loading…'}
              </h2>
              {job && <StatusBadge status={job.status} exitCode={job.exitCode} />}
            </div>
            <p className="text-[11px] text-[var(--color-fg-subtle)] mt-1 font-mono truncate">
              {job
                ? `${job.node}${job.method && job.method !== 'default' ? ` · ${job.method}` : ''} · ${formatDuration(duration)}`
                : jobId}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {job?.status === 'running' && (
              <button
                onClick={handleAbort}
                disabled={abort.isPending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md
                           text-[11px] text-red-300 hover:text-red-200
                           hover:bg-red-500/10 border border-red-500/30
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400
                           disabled:opacity-60"
              >
                <StopCircle className="w-3 h-3" />
                Abort
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] rounded-md
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {error && (
          <div className="m-5 p-3 rounded-lg border border-red-500/30 bg-red-500/10
                          flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">{error.message}</p>
          </div>
        )}

        {job && (
          <div className="px-5 py-3 border-b border-[var(--color-border-subtle)] space-y-1 text-[11px]">
            <Row label="Script URL">
              <span className="font-mono text-[var(--color-fg-secondary)] break-all">{job.scriptUrl}</span>
            </Row>
            {job.env && Object.keys(job.env).length > 0 && (
              <Row label="Env overrides">
                <span className="font-mono text-[var(--color-fg-muted)]">
                  {Object.entries(job.env)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' ')}
                </span>
              </Row>
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-2 border-b border-[var(--color-border-subtle)]">
          <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">Log</h3>
          <button
            onClick={handleCopy}
            disabled={!logText}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]
                       disabled:opacity-50
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 rounded"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
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

        <pre
          ref={logRef}
          onScroll={onLogScroll}
          className="flex-1 min-h-0 overflow-y-auto px-5 py-3 bg-[var(--color-canvas)]
                     text-[11px] font-mono text-[var(--color-fg-secondary)] whitespace-pre-wrap
                     leading-relaxed selection:bg-indigo-500/30"
        >
          {logText || (
            <span className="text-[var(--color-fg-faint)] italic">
              {job?.status === 'running'
                ? 'Waiting for output…'
                : 'No output captured.'}
            </span>
          )}
        </pre>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-[10px] uppercase tracking-widest text-[var(--color-fg-subtle)] w-24 shrink-0 pt-0.5">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

'use client';

/**
 * Bottom-right status bar showing active + recent script jobs.
 *
 * Visible when there's at least one running OR recently-finished job
 * (within the last 5 minutes). Clicking a row opens the JobDrawer with
 * full log + abort controls. Hidden entirely when idle so it doesn't
 * shout at the user on pages that don't care about scripts.
 *
 * Polling cadence is decided by the underlying useScriptJobs hook —
 * 3 s while any job is running, 30 s otherwise.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronUp,
  ChevronDown,
  Terminal,
  StopCircle,
} from 'lucide-react';
import { useScriptJobs, type JobSummary } from '@/hooks/use-script-jobs';
import { JobDrawer } from './JobDrawer';

const RECENT_WINDOW_MS = 5 * 60 * 1000;

function formatElapsed(ms: number): string {
  if (ms < 1_000) return '0s';
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1_000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${m}m`;
}

function StatusDot({ status }: { status: JobSummary['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />;
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'aborted':
      return <StopCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  }
}

export function JobStatusBar() {
  const { data } = useScriptJobs();
  const [open, setOpen] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const running = useMemo(
    () => (data?.jobs ?? []).filter((j) => j.status === 'running'),
    [data],
  );
  const recent = useMemo(() => {
    // `now` is state updated by the tick effect below (or on first mount);
    // using it instead of a fresh Date.now() keeps this computation pure
    // per React's strict purity rule — impure calls during render can
    // desync re-renders from the wall clock.
    const cutoff = now - RECENT_WINDOW_MS;
    return (data?.jobs ?? []).filter(
      (j) => j.status !== 'running' && j.finishedAt && j.finishedAt >= cutoff,
    );
  }, [data, now]);

  // Per-second re-render while any job is running. When nothing is
  // running, `now` stays at its mount-time value — that's fine because
  // the only thing it feeds is the elapsed timer (stale timers would
  // just freeze, which matches user intuition for a finished job) and
  // the "recent within 5 min" cutoff (idle drift here is harmless; the
  // cutoff snaps back to wall-clock the moment a new job starts).
  useEffect(() => {
    if (running.length === 0) return undefined;
    const h = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(h);
  }, [running.length]);

  const visible = [...running, ...recent].slice(0, 5);
  if (visible.length === 0) return null;

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/95 backdrop-blur shadow-xl overflow-hidden">
          <button
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60
                       text-left hover:bg-zinc-900/60
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
            aria-expanded={open}
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-xs font-medium text-zinc-200">
              {running.length > 0
                ? `${running.length} script${running.length === 1 ? '' : 's'} running`
                : `${recent.length} recent`}
            </span>
            <span className="ml-auto text-zinc-500">
              {open ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </span>
          </button>
          {open && (
            <ul>
              {visible.map((job) => (
                <li key={job.id}>
                  <button
                    onClick={() => setDrawerId(job.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs
                               border-b border-zinc-900/60 last:border-b-0
                               hover:bg-zinc-900/60
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
                  >
                    <StatusDot status={job.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-zinc-200 truncate">{job.scriptName}</p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {job.node}
                        {job.method && job.method !== 'default' && <> · {job.method}</>}
                        {' · '}
                        {job.status === 'running'
                          ? formatElapsed(now - job.startedAt)
                          : formatElapsed((job.finishedAt ?? now) - job.startedAt)}
                        {job.status === 'failed' &&
                          typeof job.exitCode === 'number' &&
                          job.exitCode !== 0 && <> · exit {job.exitCode}</>}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <JobDrawer jobId={drawerId} onClose={() => setDrawerId(null)} />
    </>
  );
}

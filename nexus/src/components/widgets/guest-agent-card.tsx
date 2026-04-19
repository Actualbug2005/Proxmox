'use client';

/**
 * GuestAgentCard — per-VM surface for qemu-guest-agent state.
 *
 * Rendered on the VM detail page. Complements the cluster-wide
 * GuestDiskPressure widget by showing the raw per-guest probe:
 *   - Agent reachability (liveness + reason on failure)
 *   - Filesystems list with per-mount usage
 *   - Failed systemd services from the services-probe
 *
 * The underlying hook (useGuestAgent) is operator-driven — never auto-
 * refetches. Probing a live agent traverses the host/guest ring buffer,
 * so we make the "Refresh" button explicit instead of polling.
 *
 * When `enabled=false` (guest not running), we short-circuit the hook
 * entirely by passing undefined; qemu-guest-agent only responds on
 * running guests.
 */

import {
  Loader2,
  RefreshCw,
  HeartPulse,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatBytes } from '@/lib/utils';
import { useGuestAgent } from '@/hooks/use-guest-agent';

interface GuestAgentCardProps {
  node: string;
  vmid: number;
  /** When false, skip the hook entirely — the qemu-guest-agent only
   *  responds on running guests. */
  enabled?: boolean;
}

/**
 * Render a walltime `since` epoch as a coarse "Xm ago" string.
 * Exported for unit testing; kept pure so the test can fake `Date.now`.
 *
 * `since` of 0 (or missing) means the probe didn't populate the field;
 * return "" so the caller can omit it from the UI.
 */
export function relativeAge(ms: number, now: number = Date.now()): string {
  if (!ms) return '';
  const delta = now - ms;
  if (delta < 0) return 'just now';
  if (delta < 60_000) return 'just now';
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function GuestAgentCard({ node, vmid, enabled = true }: GuestAgentCardProps) {
  const {
    data: probe,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useGuestAgent(enabled ? node : undefined, enabled ? vmid : undefined);

  const reachable = probe?.reachable === true;
  const unreachableReason = probe?.reason;
  const filesystems = probe?.filesystems;
  const failed = probe?.failedServices;

  return (
    <div className="studio-card rounded-lg p-4">
      {/* Header + refresh */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
          <HeartPulse className="h-3 w-3" />
          Guest agent
        </h3>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={!enabled || isFetching}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-overlay)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg-secondary)] disabled:opacity-40"
            aria-label="Refresh guest-agent probe"
          >
            <RefreshCw className={isFetching ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
            Refresh
          </button>
        </div>
      </div>

      {/* Disabled (stopped guest) */}
      {!enabled ? (
        <p className="py-4 text-center text-xs text-[var(--color-fg-faint)]">
          Agent check disabled (guest is stopped).
        </p>
      ) : isLoading && !probe ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-md border border-[var(--color-err)]/20 bg-[var(--color-err)]/10 p-3 text-xs text-[var(--color-err)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error.message}</span>
        </div>
      ) : probe ? (
        <div className="space-y-4">
          {/* 1. Liveness */}
          <div className="flex items-center gap-2">
            {reachable ? (
              <>
                <Badge variant="success">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Reachable
                </Badge>
                <span className="text-[11px] text-[var(--color-fg-subtle)]">
                  {node} · VM {vmid}
                </span>
              </>
            ) : (
              <>
                <Badge variant="danger">
                  <XCircle className="mr-1 h-3 w-3" />
                  Unreachable
                </Badge>
                {unreachableReason && (
                  <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                    {unreachableReason}
                  </span>
                )}
              </>
            )}
          </div>

          {/* 2. Filesystems */}
          {reachable && (
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
                Filesystems
              </div>
              {!filesystems || filesystems.length === 0 ? (
                <p className="text-xs text-[var(--color-fg-faint)]">
                  No filesystems reported.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {filesystems
                    .slice()
                    .sort((a, b) => {
                      const pa = a.totalBytes > 0 ? a.usedBytes / a.totalBytes : 0;
                      const pb = b.totalBytes > 0 ? b.usedBytes / b.totalBytes : 0;
                      return pb - pa;
                    })
                    .map((fs) => {
                      const pct = fs.totalBytes > 0
                        ? Math.round((fs.usedBytes / fs.totalBytes) * 100)
                        : 0;
                      return (
                        <li key={fs.mountpoint}>
                          <div className="mb-1 flex items-center gap-2">
                            <span className="truncate font-mono text-xs text-[var(--color-fg-secondary)]">
                              {fs.mountpoint}
                            </span>
                            <span className="text-[11px] text-[var(--color-fg-subtle)]">
                              · {fs.type}
                            </span>
                            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--color-fg-subtle)]">
                              {pct}%
                            </span>
                          </div>
                          <ProgressBar value={pct} />
                          <p className="mt-1 text-[11px] tabular-nums text-[var(--color-fg-faint)]">
                            {formatBytes(fs.usedBytes)} / {formatBytes(fs.totalBytes)}
                          </p>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          )}

          {/* 3. Failed services */}
          {reachable && (
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
                Failed services
              </div>
              {failed === undefined ? (
                <p className="text-xs text-[var(--color-fg-faint)]">
                  Services probe not yet run this session.
                </p>
              ) : failed.length === 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-ok)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  All services healthy
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {failed.map((svc) => {
                    const age = relativeAge(svc.since);
                    return (
                      <li
                        key={svc.unit}
                        className="flex items-start gap-2 rounded-md border border-[var(--color-err)]/20 bg-[var(--color-err)]/5 p-2"
                      >
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-err)]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate font-mono text-xs text-[var(--color-fg-secondary)]">
                              {svc.unit}
                            </span>
                            {age && (
                              <span className="ml-auto shrink-0 text-[11px] text-[var(--color-fg-faint)]">
                                since {age}
                              </span>
                            )}
                          </div>
                          {svc.description && (
                            <p className="mt-0.5 truncate text-[11px] text-[var(--color-fg-subtle)]">
                              {svc.description}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-[var(--color-fg-faint)]">
          No probe data yet.
        </p>
      )}
    </div>
  );
}

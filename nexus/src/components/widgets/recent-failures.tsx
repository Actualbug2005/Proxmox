'use client';

/**
 * RecentFailures widget — last ~10 failed cluster tasks.
 *
 * Pulled from useClusterHealth.pressure.recentFailures (already
 * filtered + sorted by the hook). Clicking a row lands on the tasks
 * page with the UPID anchor so the existing correlation drawer can
 * pick it up.
 */

import Link from 'next/link';
import { Loader2, XCircle } from 'lucide-react';
import { useClusterHealth } from '@/hooks/use-cluster-health';

function formatTime(epochSec: number): string {
  const diffMs = Date.now() - epochSec * 1000;
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export function RecentFailuresWidget() {
  const { pressure, loading } = useClusterHealth();
  const rows = pressure?.recentFailures.slice(0, 8) ?? [];

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
          <XCircle className="h-3 w-3" />
          Recent failures
        </h3>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--color-fg-faint)]">
          {loading ? 'Checking tasks…' : 'No recent failures.'}
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((f) => (
            <Link
              key={f.upid}
              href={`/dashboard/tasks?upid=${encodeURIComponent(f.upid)}`}
              className="block rounded-md px-2 py-1.5 transition hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-fg-secondary)]">
                  {f.type}
                  {f.id && <span className="ml-1 text-[var(--color-fg-subtle)]">({f.id})</span>}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">{f.node}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="truncate text-[11px] text-[var(--color-err)]/80">{f.exitstatus}</span>
                <span className="ml-auto shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                  {formatTime(f.starttime)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

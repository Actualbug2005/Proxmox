'use client';

/**
 * GuestDiskPressure widget — per-VM filesystem pressure from the
 * qemu-guest-agent probe (5.2).
 *
 * Only rows over the server-side threshold (0.85 by default) show up.
 * If the snapshot has never been populated (`updatedAt === 0`) we tell
 * the operator so they don't mistake an empty list for "no pressure".
 *
 * No trend column yet — the probe lib doesn't keep a per-guest time
 * series, so we can't project days-until-full without either persisting
 * a rolling buffer or hooking into RRD-for-guests. Deferred to a later
 * phase; storage-exhaustion.tsx handles the cluster-wide trend case.
 */

import Link from 'next/link';
import { HeartPulse, Loader2 } from 'lucide-react';
import { formatBytes } from '@/lib/utils';

function relativeAge(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'just now';
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useGuestPressure } from '@/hooks/use-guest-agent';
import type { DiskPressure } from '@/lib/guest-agent/types';

function pressureBadge(row: DiskPressure): {
  variant: 'danger' | 'warning' | 'info';
  label: string;
} {
  const pct = row.usedPct;
  if (pct >= 0.95) return { variant: 'danger', label: 'critical' };
  if (pct >= 0.9) return { variant: 'warning', label: 'high' };
  return { variant: 'info', label: 'watch' };
}

export function GuestDiskPressureWidget() {
  const { data, isLoading } = useGuestPressure();

  const pressures = data?.pressures ?? [];
  const unreachable = data?.unreachable ?? [];
  // Sort most-full first; for the widget cap at 8 rows so it fits the
  // bento tile without scrolling.
  const rows = [...pressures].sort((a, b) => b.usedPct - a.usedPct).slice(0, 8);
  const snapshotAge = data?.updatedAt ? relativeAge(data.updatedAt) : null;

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
          <HeartPulse className="h-3 w-3" />
          Guest disk pressure
        </h3>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>

      {data?.updatedAt === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--color-fg-faint)]">
          Waiting for first guest-agent probe…
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--color-fg-faint)]">
          {unreachable.length > 0
            ? `${unreachable.length} guest${unreachable.length === 1 ? '' : 's'} with agent unreachable`
            : 'All guest filesystems under threshold.'}
        </p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => {
            const pct = Math.round(row.usedPct * 100);
            const badge = pressureBadge(row);
            return (
              <Link
                key={`${row.node}/${row.vmid}/${row.mountpoint}`}
                href={`/dashboard/vms/${encodeURIComponent(row.node)}/${row.vmid}`}
                className="block rounded-md p-2 transition hover:bg-white/[0.03]"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="truncate text-xs text-[var(--color-fg-secondary)]">
                    VM {row.vmid}
                  </span>
                  <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                    · {row.mountpoint}
                  </span>
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">· {row.node}</span>
                  <span className="ml-auto shrink-0">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </span>
                </div>
                <ProgressBar value={pct} />
                <p className="mt-1 text-[11px] tabular text-[var(--color-fg-subtle)]">
                  {formatBytes(row.usedBytes)} / {formatBytes(row.totalBytes)} · {pct}%
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {snapshotAge && (
        <p className="mt-3 text-right text-[11px] text-[var(--color-fg-faint)]">
          Updated {snapshotAge}
        </p>
      )}
    </div>
  );
}

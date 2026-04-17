'use client';

/**
 * StorageExhaustion widget — per-datastore fill + projected days-until-full.
 *
 * Sorted by urgency (shortest days-until-full first). The underlying
 * trend comes from useClusterHealth's week-window RRD fetch.
 */

import Link from 'next/link';
import { HardDrive, Loader2 } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useClusterHealth, type StorageHealthRow } from '@/hooks/use-cluster-health';

function exhaustionBadge(row: StorageHealthRow): {
  variant: 'danger' | 'warning' | 'info' | 'outline';
  label: string;
} {
  if (row.daysUntilFull === null) return { variant: 'outline', label: 'no trend' };
  if (row.daysUntilFull === 0) return { variant: 'danger', label: 'overdue' };
  if (row.daysUntilFull < 30) return { variant: 'danger', label: `${Math.ceil(row.daysUntilFull)}d` };
  if (row.daysUntilFull < 90) return { variant: 'warning', label: `${Math.ceil(row.daysUntilFull)}d` };
  return { variant: 'info', label: `${Math.ceil(row.daysUntilFull)}d` };
}

function daysKey(row: StorageHealthRow): number {
  // null -> push to bottom; otherwise ascending (lowest urgency first
  // means most urgent at the top because less time == more urgent).
  return row.daysUntilFull === null ? Number.POSITIVE_INFINITY : row.daysUntilFull;
}

export function StorageExhaustionWidget() {
  const { storage, loading } = useClusterHealth();

  const rows = [...storage].sort((a, b) => daysKey(a) - daysKey(b)).slice(0, 8);

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          <HardDrive className="h-3 w-3" />
          Storage exhaustion
        </h3>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />}
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-600">
          {loading ? 'Projecting…' : 'No datastores.'}
        </p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => {
            const pct = Math.round(row.usedFraction * 100);
            const badge = exhaustionBadge(row);
            return (
              <Link
                key={`${row.node}/${row.storage}`}
                href={`/dashboard/storage/${encodeURIComponent(row.node)}`}
                className="block rounded-md p-2 transition hover:bg-white/[0.03]"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="truncate text-xs text-zinc-200">{row.storage}</span>
                  <span className="text-[11px] text-zinc-500">· {row.node}</span>
                  <span className="ml-auto shrink-0">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </span>
                </div>
                <ProgressBar value={pct} />
                <p className="mt-1 text-[11px] tabular text-zinc-500">
                  {formatBytes(row.used)} / {formatBytes(row.total)} · {pct}%
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

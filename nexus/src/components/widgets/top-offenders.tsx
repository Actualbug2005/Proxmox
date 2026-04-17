'use client';

/**
 * TopOffenders widget — hottest guests by CPU and by memory.
 *
 * Split into two stacked lists (CPU, then memory) inside one card so
 * it can span a single column in the preset grid.
 */

import Link from 'next/link';
import { Cpu, Loader2, MemoryStick } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClusterHealth } from '@/hooks/use-cluster-health';
import type { TopGuest } from '@/lib/cluster-pressure';

function guestHref(g: TopGuest): string {
  if (!g.node || g.vmid === undefined) return '#';
  if (g.type === 'qemu') return `/dashboard/vms/${g.node}/${g.vmid}`;
  return `/dashboard/cts/${g.node}/${g.vmid}`;
}

function valueBadge(fraction: number): string {
  const pct = Math.round(fraction * 100);
  if (pct > 85) return 'text-red-300';
  if (pct > 65) return 'text-amber-300';
  return 'text-emerald-300';
}

export function TopOffendersWidget() {
  const { pressure, loading } = useClusterHealth();

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
          Top offenders
        </h3>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>

      {!pressure ? (
        <p className="py-6 text-center text-xs text-[var(--color-fg-faint)]">
          {loading ? 'Ranking…' : 'No data.'}
        </p>
      ) : (
        <div className="space-y-4">
          <OffenderList
            title="CPU"
            icon={<Cpu className="h-3 w-3 text-[var(--color-fg-subtle)]" />}
            guests={pressure.topGuestsByCpu.slice(0, 4)}
          />
          <OffenderList
            title="Memory"
            icon={<MemoryStick className="h-3 w-3 text-[var(--color-fg-subtle)]" />}
            guests={pressure.topGuestsByMemory.slice(0, 4)}
          />
        </div>
      )}
    </div>
  );
}

function OffenderList({
  title,
  icon,
  guests,
}: {
  title: string;
  icon: React.ReactNode;
  guests: TopGuest[];
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)]">{title}</span>
      </div>
      {guests.length === 0 ? (
        <p className="py-1 text-xs text-[var(--color-fg-faint)]">Nothing notable.</p>
      ) : (
        <div className="space-y-1">
          {guests.map((g) => (
            <Link
              key={g.id}
              href={guestHref(g)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs transition hover:bg-white/[0.03]"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--color-fg-secondary)]">
                {g.name ?? `${g.type}/${g.vmid}`}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--color-fg-subtle)]">{g.node}</span>
              <span className={cn('shrink-0 tabular', valueBadge(g.value))}>
                {Math.round(g.value * 100)}%
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

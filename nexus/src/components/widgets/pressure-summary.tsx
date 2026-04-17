'use client';

/**
 * PressureSummary widget — cluster-wide CPU / memory / load averages.
 *
 * Reuses useClusterHealth so we don't re-derive these numbers; the hook
 * also owns the RRD fetch for storage, so reusing it here means the NOC
 * preset (pressure + storage + failures + offenders) hits the same
 * cached query data across widgets.
 */

import { Activity, Cpu, Loader2, MemoryStick } from 'lucide-react';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useClusterHealth } from '@/hooks/use-cluster-health';

function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

export function PressureSummaryWidget() {
  const { pressure, loading } = useClusterHealth();

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
          Cluster Pressure
        </h3>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-fg-subtle)]" />}
      </div>

      {!pressure ? (
        <p className="py-6 text-center text-xs text-[var(--color-fg-faint)]">
          {loading ? 'Gathering signals…' : 'No data.'}
        </p>
      ) : (
        <div className="space-y-4">
          <Row
            icon={<Cpu className="h-3.5 w-3.5 text-[var(--color-fg-muted)]" />}
            label="CPU"
            percent={pct(pressure.avgCpu)}
            detail={`${pressure.nodesOnline}/${pressure.nodesTotal} nodes online`}
          />
          <Row
            icon={<MemoryStick className="h-3.5 w-3.5 text-[var(--color-fg-muted)]" />}
            label="Memory"
            percent={pct(pressure.avgMemory)}
            detail={`${pressure.runningGuests}/${pressure.totalGuests} guests running`}
          />
          {pressure.peakLoadavgPerCore !== undefined && (
            <Row
              icon={<Activity className="h-3.5 w-3.5 text-[var(--color-fg-muted)]" />}
              label="Peak load / core"
              percent={Math.min(100, Math.round(pressure.peakLoadavgPerCore * 100))}
              detail={pressure.peakLoadavgPerCore.toFixed(2)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  percent,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number;
  detail: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon}
        <span className="text-xs text-[var(--color-fg-muted)]">{label}</span>
        <span className="ml-auto text-xs tabular text-[var(--color-fg-secondary)]">{percent}%</span>
      </div>
      <ProgressBar value={percent} />
      <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{detail}</p>
    </div>
  );
}

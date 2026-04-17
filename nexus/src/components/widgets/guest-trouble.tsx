'use client';

/**
 * GuestTrouble widget — VMs/CTs whose current status is not "running".
 *
 * Stopped, paused, and suspended guests are all surfaced; a healthy
 * cluster shows an empty-state card so the Incidents preset doesn't
 * look broken when everything is fine.
 */

import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useClusterResources } from '@/hooks/use-cluster';

export function GuestTroubleWidget() {
  const { data: resources, isLoading } = useClusterResources();

  const trouble = (resources ?? []).filter(
    (r) =>
      (r.type === 'qemu' || r.type === 'lxc') &&
      r.status &&
      r.status !== 'running',
  );

  return (
    <div className="studio-card h-full rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          <AlertTriangle className="h-3 w-3" />
          Guests needing attention
        </h3>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />}
      </div>

      {trouble.length === 0 ? (
        <p className="py-6 text-center text-xs text-emerald-400/80">
          {isLoading ? 'Scanning guests…' : 'All guests are running.'}
        </p>
      ) : (
        <div className="space-y-1">
          {trouble.slice(0, 12).map((g) => {
            const base = g.type === 'qemu' ? '/dashboard/vms' : '/dashboard/cts';
            const href = g.node && g.vmid ? `${base}/${g.node}/${g.vmid}` : '#';
            return (
              <Link
                key={g.id}
                href={href}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-white/[0.03]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="min-w-0 flex-1 truncate text-zinc-200">
                  {g.name ?? `${g.type}/${g.vmid}`}
                </span>
                <span className="shrink-0 font-mono text-[11px] uppercase text-zinc-500">
                  {g.type}
                </span>
                <span className="shrink-0 text-[11px] text-amber-300">{g.status}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

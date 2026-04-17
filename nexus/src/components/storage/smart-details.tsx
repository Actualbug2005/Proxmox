'use client';

/**
 * S.M.A.R.T. detail sheet — opened from the Physical Disks table.
 * Fetches GET /nodes/{node}/disks/smart on mount and renders the overall
 * health badge + per-attribute table.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, X, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import type { SmartHealth, SmartAttribute } from '@/types/proxmox';

interface SmartDetailsProps {
  node: string;
  disk: { devpath: string; model?: string; type: string };
  onClose: () => void;
}

const HEALTH_VARIANT: Record<SmartHealth, 'success' | 'danger' | 'warning'> = {
  PASSED: 'success',
  FAILED: 'danger',
  UNKNOWN: 'warning',
};

function HealthIcon({ health }: { health: SmartHealth }) {
  if (health === 'PASSED') return <ShieldCheck className="w-5 h-5 text-emerald-400" />;
  if (health === 'FAILED') return <ShieldAlert className="w-5 h-5 text-red-400" />;
  return <ShieldQuestion className="w-5 h-5 text-yellow-400" />;
}

/** Highlight rows whose normalised value has dropped to / below the failure
 *  threshold. PVE forwards smartctl's normalisation directly, so this is the
 *  canonical "this attribute is in trouble" check. */
function isAttributeFailing(attr: SmartAttribute): boolean {
  if (attr.value === undefined || attr.threshold === undefined) return false;
  return attr.value <= attr.threshold;
}

export function SmartDetails({ node, disk, onClose }: SmartDetailsProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['disk-smart', node, disk.devpath],
    queryFn: () => api.disks.smart(node, disk.devpath),
    // SMART rarely changes minute-to-minute; don't poll the disk constantly.
    refetchInterval: false,
    staleTime: 60_000,
  });

  // Sort attributes so failing entries surface to the top, then by id, then name.
  const attributes = useMemo<SmartAttribute[]>(() => {
    const list = data?.attributes ?? [];
    return [...list].sort((a, b) => {
      const aFail = isAttributeFailing(a) ? 0 : 1;
      const bFail = isAttributeFailing(b) ? 0 : 1;
      if (aFail !== bFail) return aFail - bFail;
      if ((a.id ?? 999) !== (b.id ?? 999)) return (a.id ?? 999) - (b.id ?? 999);
      return a.name.localeCompare(b.name);
    });
  }, [data]);

  const health: SmartHealth = data?.health ?? 'UNKNOWN';

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="studio-card w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3 min-w-0">
            <HealthIcon health={health} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {disk.devpath}
                {disk.model && <span className="text-[var(--color-fg-subtle)] font-normal ml-2">{disk.model}</span>}
              </p>
              <p className="text-xs text-[var(--color-fg-subtle)]">
                S.M.A.R.T. report · {node} · {disk.type}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Badge variant={HEALTH_VARIANT[health]}>{health}</Badge>
            <button
              onClick={onClose}
              className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 m-5 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Failed to read S.M.A.R.T. data: {error instanceof Error ? error.message : String(error)}
              </span>
            </div>
          )}

          {!isLoading && !error && data?.type === 'text' && (
            <pre className="m-5 p-4 bg-gray-950 border border-[var(--color-border-subtle)] rounded-lg text-xs text-[var(--color-fg-muted)] font-mono overflow-x-auto whitespace-pre-wrap">
              {data.text ?? '(no output)'}
            </pre>
          )}

          {!isLoading && !error && data && data.type !== 'text' && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border-subtle)]">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[var(--color-fg-subtle)] font-medium w-12">ID</th>
                  <th className="text-left px-4 py-2.5 text-[var(--color-fg-subtle)] font-medium">Attribute</th>
                  <th className="text-right px-4 py-2.5 text-[var(--color-fg-subtle)] font-medium w-16">Value</th>
                  <th className="text-right px-4 py-2.5 text-[var(--color-fg-subtle)] font-medium w-16">Worst</th>
                  <th className="text-right px-4 py-2.5 text-[var(--color-fg-subtle)] font-medium w-20">Threshold</th>
                  <th className="text-left px-4 py-2.5 text-[var(--color-fg-subtle)] font-medium">Raw</th>
                </tr>
              </thead>
              <tbody>
                {attributes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-[var(--color-fg-faint)]">
                      No S.M.A.R.T. attributes returned.
                    </td>
                  </tr>
                )}
                {attributes.map((a, i) => {
                  const failing = isAttributeFailing(a);
                  return (
                    <tr
                      key={`${a.id ?? a.name}-${i}`}
                      className={
                        failing
                          ? 'border-b border-[var(--color-border-subtle)] bg-red-500/5'
                          : 'border-b border-zinc-800/40 hover:bg-zinc-800/30'
                      }
                    >
                      <td className="px-4 py-2 font-mono text-[var(--color-fg-subtle)]">{a.id ?? '—'}</td>
                      <td className="px-4 py-2 text-[var(--color-fg-secondary)]">{a.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-[var(--color-fg-secondary)]">{a.value ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-[var(--color-fg-subtle)]">{a.worst ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-[var(--color-fg-subtle)]">
                        {a.threshold ?? '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-[var(--color-fg-muted)] break-all">{a.raw ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

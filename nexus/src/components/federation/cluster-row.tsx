'use client';

/**
 * One row of the federation clusters table.
 *
 * Severity mapping for the status dot/text follows the spec:
 *   - probe === null                            → grey  "Probing…"
 *   - !probe.reachable                          → red   "Unreachable"
 *   - reachable && quorate === false            → amber "No quorum"
 *   - reachable && quorate === null             → amber "Reachable (quorum unknown)"
 *   - reachable && quorate === true             → green "Healthy"
 */
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, KeyRound, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusDot, type DotStatus } from '@/components/ui/status-dot';

export interface FederatedClusterProbe {
  reachable: boolean;
  activeEndpoint: string | null;
  latencyMs: number | null;
  pveVersion: string | null;
  quorate: boolean | null;
  lastProbedAt: number;
  lastError: string | null;
}

export interface FederatedClusterView {
  id: string;
  name: string;
  endpoints: string[];
  authMode: 'token';
  tokenId: string;
  savedAt: number;
  rotatedAt: number;
  probe: FederatedClusterProbe | null;
}

interface ClusterRowProps {
  cluster: FederatedClusterView;
  onRotate: () => void;
  onRemove: () => void;
}

interface StatusView {
  dot: DotStatus;
  label: string;
}

function statusFor(probe: FederatedClusterProbe | null): StatusView {
  if (!probe) return { dot: 'unknown', label: 'Probing…' };
  if (!probe.reachable) return { dot: 'error', label: 'Unreachable' };
  if (probe.quorate === false) return { dot: 'warning', label: 'No quorum' };
  if (probe.quorate === null) return { dot: 'warning', label: 'Reachable (quorum unknown)' };
  return { dot: 'running', label: 'Healthy' };
}

function stripScheme(url: string | null): string {
  if (!url) return '—';
  return url.replace(/^https?:\/\//, '');
}

function relativeTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ClusterRow({ cluster, onRotate, onRemove }: ClusterRowProps) {
  const { probe } = cluster;
  const status = statusFor(probe);
  const activeEndpoint = probe?.activeEndpoint ?? cluster.endpoints[0] ?? null;

  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-overlay)]/50 transition">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusDot status={status.dot} size="sm" aria-label={status.label} />
          <span
            className={cn(
              'text-xs',
              status.dot === 'error' && 'text-[var(--color-err)]',
              status.dot === 'warning' && 'text-[var(--color-warn)]',
              status.dot === 'running' && 'text-[var(--color-ok)]',
              status.dot === 'unknown' && 'text-[var(--color-fg-subtle)]',
            )}
          >
            {status.label}
          </span>
        </div>
        {probe?.lastError && (
          <div
            className="text-[11px] text-[var(--color-err)]/80 mt-0.5 truncate max-w-[200px]"
            title={probe.lastError}
          >
            {probe.lastError}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-[var(--color-fg)]">{cluster.name}</div>
        <div className="text-xs text-[var(--color-fg-subtle)] font-mono">{cluster.id}</div>
      </td>
      <td className="px-4 py-3">
        {activeEndpoint ? (
          <span
            className="text-xs font-mono text-[var(--color-fg-secondary)]"
            title={activeEndpoint}
          >
            {stripScheme(activeEndpoint)}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-fg-faint)]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs font-mono text-[var(--color-fg-secondary)]">
        {probe?.pveVersion ?? <span className="text-[var(--color-fg-faint)]">—</span>}
      </td>
      <td className="px-4 py-3 text-right text-xs font-mono tabular text-[var(--color-fg-secondary)]">
        {probe?.latencyMs != null ? (
          `${Math.round(probe.latencyMs)} ms`
        ) : (
          <span className="text-[var(--color-fg-faint)]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs font-mono tabular text-[var(--color-fg-subtle)]">
        {relativeTime(probe?.lastProbedAt ?? null)}
      </td>
      <td className="px-4 py-3 text-right">
        <KebabMenu onRotate={onRotate} onRemove={onRemove} />
      </td>
    </tr>
  );
}

function KebabMenu({ onRotate, onRemove }: { onRotate: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Cluster actions"
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded-md text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-overlay)] transition"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-56 studio-card rounded-lg p-1 shadow-2xl"
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onRotate();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs rounded-md text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)] transition"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Rotate credentials
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs rounded-md text-[var(--color-err)] hover:bg-[var(--color-err)]/10 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

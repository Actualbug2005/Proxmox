'use client';

/**
 * Recent dispatches — read-only activity feed.
 *
 * Backed by the in-process ring buffer (non-persisted; resets on
 * Nexus restart). Live-polled at 30 s. Cross-references the rule +
 * destination lists so the operator sees human names rather than
 * UUIDs.
 */
import { Loader2, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  useDestinations,
  useRecentDispatches,
  useRules,
} from '@/hooks/use-notifications';
import type { DispatchRecord } from '@/lib/notifications/types';

// Look up helpers — tolerant of cascade deletes (a dispatch record may
// reference a rule / destination that was since removed). "(deleted)" in
// the table is more useful than a blank cell.
function lookupRule(rules: { id: string; name: string }[], id: string): string {
  return rules.find((r) => r.id === id)?.name ?? '(deleted rule)';
}
function lookupDest(dests: { id: string; name: string }[], id: string): string {
  return dests.find((d) => d.id === id)?.name ?? '(deleted destination)';
}

function OutcomeIcon({ outcome }: { outcome: DispatchRecord['outcome'] }) {
  if (outcome === 'sent') return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-ok)]" />;
  if (outcome === 'skipped') return <MinusCircle className="w-3.5 h-3.5 text-[var(--color-fg-subtle)]" />;
  return <XCircle className="w-3.5 h-3.5 text-[var(--color-err)]" />;
}

function outcomeBadge(outcome: DispatchRecord['outcome']) {
  if (outcome === 'sent') return <Badge variant="success">sent</Badge>;
  if (outcome === 'skipped') return <Badge variant="outline">skipped</Badge>;
  return <Badge variant="danger">failed</Badge>;
}

export function RecentTab() {
  const { data: records, isLoading, error } = useRecentDispatches(50);
  const { data: rules } = useRules();
  const { data: destinations } = useDestinations();

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-fg-subtle)]">
        Last 50 dispatch attempts from the in-process ring buffer. Not
        persisted across restarts. Refreshes every 30 s.
      </p>

      <div className="studio-card overflow-hidden">
        {isLoading && (
          <div className="p-8 flex items-center justify-center text-[var(--color-fg-subtle)]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        {error && (
          <div className="p-6 text-sm text-[var(--color-err)] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error.message}</span>
          </div>
        )}
        {!isLoading && !error && (!records || records.length === 0) && (
          <div className="p-10 text-center">
            <p className="text-sm text-[var(--color-fg-faint)]">
              No dispatch activity in this process lifetime. The ring
              starts filling as soon as a rule matches an event.
            </p>
          </div>
        )}
        {!isLoading && !error && records && records.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-3 font-medium">When</th>
                <th className="text-left px-4 py-3 font-medium w-10">&nbsp;</th>
                <th className="text-left px-4 py-3 font-medium">Outcome</th>
                <th className="text-left px-4 py-3 font-medium">Rule</th>
                <th className="text-left px-4 py-3 font-medium">Destination</th>
                <th className="text-left px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr
                  key={`${r.ruleId}-${r.at}-${i}`}
                  className={cn(
                    'border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-overlay)]/50 transition',
                    r.outcome === 'failed' && 'bg-[var(--color-err)]/5',
                  )}
                >
                  <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)] tabular font-mono whitespace-nowrap">
                    {new Date(r.at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <OutcomeIcon outcome={r.outcome} />
                  </td>
                  <td className="px-4 py-3">{outcomeBadge(r.outcome)}</td>
                  <td className="px-4 py-3 text-[var(--color-fg-secondary)]">
                    {lookupRule(rules ?? [], r.ruleId)}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-fg-secondary)]">
                    {lookupDest(destinations ?? [], r.destinationId)}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)]">
                    {r.outcome === 'sent' && r.status != null && `HTTP ${r.status}`}
                    {r.outcome === 'failed' && (r.reason ?? `HTTP ${r.status ?? '—'}`)}
                    {r.outcome === 'skipped' && r.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

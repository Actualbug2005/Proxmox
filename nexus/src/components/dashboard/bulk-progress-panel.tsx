'use client';

/**
 * Floating progress panel for bulk lifecycle batches.
 *
 * Anchored bottom-right, mounted once in the app shell. Renders the
 * caller's most recent non-terminal batch (or the single most recent
 * batch overall if nothing is active) with a per-item status list.
 * Dismiss hides the panel for the current batch id; a new batch
 * surfaces it again automatically.
 *
 * Status icon conventions are lifted from task-list.tsx so the two
 * feel consistent — a "batch" is effectively a fan-out over PVE tasks.
 */

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  SkipForward,
  X,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useBulkBatches,
  useCancelBulkOp,
  type BulkBatchDto,
} from '@/hooks/use-bulk-lifecycle';

const OP_LABELS: Record<BulkBatchDto['op'], string> = {
  start: 'Start',
  stop: 'Stop',
  shutdown: 'Shutdown',
  reboot: 'Reboot',
  snapshot: 'Snapshot',
};

function itemIcon(status: BulkBatchDto['items'][number]['status']) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-indigo-300 animate-spin" />;
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-ok)]" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-[var(--color-err)]" />;
    case 'skipped':
      return <SkipForward className="w-3.5 h-3.5 text-[var(--color-fg-subtle)]" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-[var(--color-fg-faint)]" />;
  }
}

function summarise(batch: BulkBatchDto) {
  const counts = { success: 0, failed: 0, skipped: 0, running: 0, pending: 0 };
  for (const i of batch.items) counts[i.status] += 1;
  const done = counts.success + counts.failed + counts.skipped;
  const total = batch.items.length;
  return { done, total, ...counts };
}

/**
 * Pick the batch to highlight: the newest non-terminal one if any,
 * otherwise the newest overall. Null when there are no batches at all.
 */
function pickPrimary(batches: BulkBatchDto[]): BulkBatchDto | null {
  if (batches.length === 0) return null;
  const active = batches.find(
    (b) => !b.finishedAt || b.items.some((i) => i.status === 'pending' || i.status === 'running'),
  );
  return active ?? batches[0];
}

export function BulkProgressPanel() {
  const { data } = useBulkBatches();
  const cancel = useCancelBulkOp();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const batches = (data?.batches ?? []).filter((b) => !dismissedIds.has(b.id));
  const primary = pickPrimary(batches);
  if (!primary) return null;

  const summary = summarise(primary);
  const finished = primary.finishedAt !== undefined;
  const hasFailures = summary.failed > 0;
  const canCancel = !finished && summary.pending > 0;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-96 max-w-[calc(100vw-2rem)]">
      <div className="studio-card rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--color-fg)] truncate">
              Bulk {OP_LABELS[primary.op].toLowerCase()} ·{' '}
              <span className="tabular font-mono">
                {summary.done}/{summary.total}
              </span>
              {finished ? (
                hasFailures ? (
                  <span className="text-[var(--color-err)] ml-1">· {summary.failed} failed</span>
                ) : (
                  <span className="text-[var(--color-ok)] ml-1">· complete</span>
                )
              ) : (
                <span className="text-indigo-300 ml-1">· in progress</span>
              )}
            </div>
            {primary.op === 'snapshot' && primary.snapshot && (
              <div className="text-xs text-[var(--color-fg-subtle)] font-mono truncate">
                {primary.snapshot.snapname}
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setDismissedIds((prev) => new Set(prev).add(primary.id))}
            className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {!collapsed && (
          <div className="max-h-64 overflow-y-auto">
            {primary.items.map((item, idx) => (
              <div
                key={`${item.node}-${item.vmid}-${idx}`}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 text-xs border-b border-zinc-800/40 last:border-0',
                  item.status === 'failed' && 'bg-[var(--color-err)]/5',
                )}
              >
                {itemIcon(item.status)}
                <span className="flex-1 truncate text-[var(--color-fg-secondary)]">
                  <span className="text-[var(--color-fg-subtle)] font-mono">{item.guestType}</span>{' '}
                  <span className="font-mono tabular">{item.vmid}</span>
                  {item.name && <span className="text-[var(--color-fg-muted)] ml-1">· {item.name}</span>}
                  <span className="text-[var(--color-fg-faint)] ml-1">· {item.node}</span>
                </span>
                {item.error && (
                  <span
                    className="text-[var(--color-err)] truncate max-w-[40%]"
                    title={item.error}
                  >
                    {item.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        {canCancel && (
          <div className="px-3 py-2 border-t border-[var(--color-border-subtle)] flex justify-end">
            <button
              onClick={() => cancel.mutate(primary.id)}
              disabled={cancel.isPending}
              className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)] transition disabled:opacity-40"
            >
              Cancel pending items
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

/**
 * Bulk action bar for the resource tree.
 *
 * Renders above the tree when at least one guest (qemu/lxc) is selected.
 * Exposes five lifecycle ops — start, shutdown, reboot, stop, snapshot —
 * and the "clear selection" affordance.
 *
 * Phase 1 scope: intent capture only. The `onAction` callback is wired by
 * the parent; Phase 4 will route it to the bulk-lifecycle API mutation.
 * Snapshot opens a nested prompt for snapname+description; the other ops
 * go through a single confirm.
 */

import { useState } from 'react';
import {
  Camera,
  Play,
  Power,
  PowerOff,
  RotateCw,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import type { ClusterResourcePublic } from '@/types/proxmox';

export type BulkOp = 'start' | 'stop' | 'shutdown' | 'reboot' | 'snapshot';

export interface SnapshotParams {
  snapname: string;
  description?: string;
  vmstate?: boolean;
}

export interface BulkActionRequest {
  op: BulkOp;
  snapshot?: SnapshotParams;
}

interface BulkActionBarProps {
  selected: ClusterResourcePublic[];
  onClear: () => void;
  onAction: (request: BulkActionRequest) => void;
  disabled?: boolean;
}

// Which ops are valid given the current selection? A button is enabled
// when at least one selected guest could accept the action. The server
// re-validates per-item anyway; this is a UX hint, not a security gate.
function computeAvailability(selected: ClusterResourcePublic[]) {
  let hasRunning = false;
  let hasStopped = false;
  for (const r of selected) {
    if (r.status === 'running') hasRunning = true;
    else if (r.status === 'stopped') hasStopped = true;
  }
  return {
    start: hasStopped,
    shutdown: hasRunning,
    reboot: hasRunning,
    stop: hasRunning,
    snapshot: selected.length > 0,
  };
}

// Human label + icon for each op, used by the button grid and the
// confirm dialog.
const OPS: Array<{
  op: BulkOp;
  label: string;
  icon: typeof Play;
  danger?: boolean;
}> = [
  { op: 'start',    label: 'Start',     icon: Play },
  { op: 'reboot',   label: 'Reboot',    icon: RotateCw },
  { op: 'shutdown', label: 'Shutdown',  icon: Power },
  { op: 'stop',     label: 'Stop',      icon: PowerOff, danger: true },
  { op: 'snapshot', label: 'Snapshot…', icon: Camera },
];

export function BulkActionBar({
  selected,
  onClear,
  onAction,
  disabled,
}: BulkActionBarProps) {
  const [pending, setPending] = useState<BulkOp | null>(null);
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapname, setSnapname] = useState('');
  const [snapDescription, setSnapDescription] = useState('');
  const [snapVmstate, setSnapVmstate] = useState(false);

  if (selected.length === 0) return null;

  const availability = computeAvailability(selected);

  const request = (op: BulkOp) => {
    if (op === 'snapshot') {
      setSnapname(`nexus-${new Date().toISOString().slice(0, 10)}`);
      setSnapDescription('');
      setSnapVmstate(false);
      setSnapOpen(true);
      return;
    }
    setPending(op);
  };

  const fire = (op: BulkOp, snapshot?: SnapshotParams) => {
    onAction({ op, snapshot });
    setPending(null);
    setSnapOpen(false);
  };

  return (
    <>
      <div className="studio-card rounded-lg p-2 flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-[var(--color-fg-secondary)] px-2 tabular">
          {selected.length} selected
        </span>
        <div className="flex-1 flex items-center gap-1 flex-wrap">
          {OPS.map(({ op, label, icon: Icon, danger }) => {
            const enabled = !disabled && availability[op];
            return (
              <button
                key={op}
                onClick={() => request(op)}
                disabled={!enabled}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
                  enabled
                    ? danger
                      ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30'
                      : 'bg-[var(--color-overlay)] hover:bg-zinc-700 text-[var(--color-fg-secondary)] border border-zinc-700/60'
                    : 'bg-[var(--color-surface)] text-[var(--color-fg-faint)] border border-[var(--color-border-subtle)] cursor-not-allowed',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>
        <button
          onClick={onClear}
          className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {pending && (
        <ConfirmDialog
          title={`${OPS.find((o) => o.op === pending)!.label} ${selected.length} guest${selected.length === 1 ? '' : 's'}?`}
          message={`This will ${pending} ${selected.length} VM/CT${selected.length === 1 ? '' : 's'} across their respective nodes. Actions run in small waves to avoid overwhelming the cluster.`}
          danger={pending === 'stop'}
          onConfirm={() => fire(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {snapOpen && (
        <SnapshotPrompt
          count={selected.length}
          snapname={snapname}
          setSnapname={setSnapname}
          description={snapDescription}
          setDescription={setSnapDescription}
          vmstate={snapVmstate}
          setVmstate={setSnapVmstate}
          onCancel={() => setSnapOpen(false)}
          onConfirm={() =>
            fire('snapshot', {
              snapname: snapname.trim(),
              description: snapDescription.trim() || undefined,
              vmstate: snapVmstate,
            })
          }
        />
      )}
    </>
  );
}

// ─── Snapshot prompt ─────────────────────────────────────────────────────────

// PVE's allowed snapshot-name characters per pve-api schema: leading letter,
// then [A-Za-z0-9_-], length 1..40. Mirrors the server-side validator in
// Phase 3 (kept client-side for immediate feedback).
const SNAPNAME_RE = /^[A-Za-z][A-Za-z0-9_\-]{0,39}$/;

function SnapshotPrompt({
  count,
  snapname,
  setSnapname,
  description,
  setDescription,
  vmstate,
  setVmstate,
  onCancel,
  onConfirm,
}: {
  count: number;
  snapname: string;
  setSnapname: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  vmstate: boolean;
  setVmstate: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const trimmed = snapname.trim();
  const valid = SNAPNAME_RE.test(trimmed);

  const inputCls =
    'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <Camera className="w-5 h-5 mt-0.5 shrink-0 text-[var(--color-fg-secondary)]" />
          <div>
            <h3 className="text-sm font-semibold text-white">Snapshot {count} guest{count === 1 ? '' : 's'}</h3>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              The same snapshot name is applied to every selected guest.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Snapshot name</label>
            <input
              value={snapname}
              onChange={(e) => setSnapname(e.target.value)}
              placeholder="before-update"
              className={cn(inputCls, !valid && trimmed.length > 0 && 'border-red-500/50')}
            />
            {!valid && trimmed.length > 0 && (
              <p className="text-xs text-red-400 mt-1">
                Must start with a letter; letters, digits, <code>_</code>, <code>-</code> only; 1–40 chars.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-fg-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={vmstate}
              onChange={(e) => setVmstate(e.target.checked)}
              className="rounded border-gray-600"
            />
            Include RAM state (QEMU only; skipped for LXC)
          </label>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!valid}
            className="px-4 py-2 text-sm font-medium bg-zinc-300 hover:bg-zinc-200 text-zinc-900 rounded-lg transition disabled:opacity-40"
          >
            Create snapshot
          </button>
        </div>
      </div>
    </div>
  );
}

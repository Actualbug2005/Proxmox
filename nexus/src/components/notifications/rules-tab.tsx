'use client';

/**
 * Rules tab — table + create / edit / delete / inline-toggle.
 *
 * Row actions:
 *  - enabled toggle (PATCH only `enabled`, no modal) — lets operators
 *    silence a rule without editing it
 *  - edit (opens the RuleForm)
 *  - delete (ConfirmDialog)
 *
 * Row status column shows the rule's current run state — backoff
 * position via `consecutiveFires`, last-fire timestamp, and a "cleared"
 * pill when the predicate is currently quiet.
 */
import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ModalShell } from '@/components/ui/modal-shell';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  useCreateRule,
  useDeleteRule,
  useDestinations,
  useRules,
  useUpdateRule,
} from '@/hooks/use-notifications';
import type { Rule } from '@/lib/notifications/types';
import { KIND_LABELS } from '@/lib/notifications/fixtures';
import { RuleForm, synthesiseInitialFromRule, type RuleFormValue } from './rule-form';

function destName(destinations: { id: string; name: string }[], id: string): string {
  return destinations.find((d) => d.id === id)?.name ?? '(missing)';
}

function formatRelative(ms: number | undefined): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function RulesTab() {
  const { data: rules, isLoading, error } = useRules();
  const { data: destinations } = useDestinations();
  const createM = useCreateRule();
  const updateM = useUpdateRule();
  const deleteM = useDeleteRule();
  const toast = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
  const [formError, setFormError] = useState<string | undefined>();

  function openCreate() {
    setEditing(null);
    setFormError(undefined);
    setFormOpen(true);
  }
  function openEdit(r: Rule) {
    setEditing(r);
    setFormError(undefined);
    setFormOpen(true);
  }

  function handleSubmit(value: RuleFormValue) {
    setFormError(undefined);
    const onErr = (e: Error) => setFormError(e.message);
    if (editing) {
      updateM.mutate(
        { id: editing.id, patch: value },
        {
          onSuccess: () => {
            toast.success('Rule updated', value.name);
            setFormOpen(false);
          },
          onError: onErr,
        },
      );
    } else {
      createM.mutate(value, {
        onSuccess: () => {
          toast.success('Rule added', value.name);
          setFormOpen(false);
        },
        onError: onErr,
      });
    }
  }

  function handleToggle(rule: Rule, next: boolean) {
    updateM.mutate(
      { id: rule.id, patch: { enabled: next } },
      {
        onSuccess: () => toast.success(next ? 'Rule enabled' : 'Rule disabled', rule.name),
        onError: (err) => toast.error('Toggle failed', err.message),
      },
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteM.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success('Rule deleted', deleteTarget.name);
        setDeleteTarget(null);
      },
      onError: (err) => toast.error('Delete failed', err.message),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Rules match events against criteria and fire notifications via
          the selected destination. Backoff keeps the pager quiet during
          sustained conditions — the live preview in the editor shows
          the cadence.
        </p>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" /> Add rule
        </Button>
      </div>

      <div className="studio-card overflow-hidden">
        {isLoading && (
          <div className="p-8 flex items-center justify-center text-[var(--color-fg-subtle)]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        {error && (
          <div className="p-6 text-sm text-[var(--color-err)]">{error.message}</div>
        )}
        {!isLoading && !error && (!rules || rules.length === 0) && (
          <div className="p-10 text-center">
            <p className="text-sm text-[var(--color-fg-faint)] mb-3">
              No rules yet — add one to start receiving notifications.
            </p>
            <Button variant="secondary" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Add rule
            </Button>
          </div>
        )}
        {!isLoading && !error && rules && rules.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-3 font-medium w-14">On</th>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Trigger</th>
                <th className="text-left px-4 py-3 font-medium">Destination</th>
                <th className="text-left px-4 py-3 font-medium">Last fire</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-overlay)]/50 transition',
                    !r.enabled && 'opacity-60',
                  )}
                >
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => handleToggle(r, e.target.checked)}
                        className="rounded border-[var(--color-border-subtle)]"
                        aria-label={r.enabled ? 'Disable rule' : 'Enable rule'}
                      />
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--color-fg)]">{r.name}</div>
                    {r.consecutiveFires > 0 && (
                      <div className="text-xs text-[var(--color-warn)] mt-0.5">
                        Fired {r.consecutiveFires}× — next eligible {formatRelative(r.nextEligibleAt)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{KIND_LABELS[r.match.eventKind]}</Badge>
                    {r.match.scope && (
                      <span className="text-xs text-[var(--color-fg-subtle)] font-mono ml-1.5">
                        · {r.match.scope}
                      </span>
                    )}
                    {r.match.eventKind === 'metric.threshold.crossed' && r.match.metric && (
                      <div className="text-xs text-[var(--color-fg-subtle)] font-mono mt-0.5">
                        {r.match.metric} {r.match.op} {r.match.threshold}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-fg-secondary)]">
                    {destName(destinations ?? [], r.destinationId)}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)] tabular font-mono">
                    {formatRelative(r.lastFireAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton onClick={() => openEdit(r)} label={`Edit ${r.name}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        onClick={() => setDeleteTarget(r)}
                        label={`Delete ${r.name}`}
                        danger
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && (
        <ModalShell size="2xl" onClose={() => setFormOpen(false)}>
          <h2 className="text-sm font-semibold text-[var(--color-fg)] mb-4">
            {editing ? `Edit ${editing.name}` : 'Add rule'}
          </h2>
          <RuleForm
            initial={editing ? synthesiseInitialFromRule(editing) : null}
            destinations={destinations ?? []}
            isPending={createM.isPending || updateM.isPending}
            error={formError}
            onSubmit={handleSubmit}
            onCancel={() => setFormOpen(false)}
          />
        </ModalShell>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.name}?`}
          message="This rule will no longer fire notifications. Backoff state and recent-dispatch history are lost."
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function IconButton({
  children, onClick, disabled, label, danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'p-1.5 rounded-lg transition disabled:opacity-50',
        danger
          ? 'text-[var(--color-fg-subtle)] hover:text-[var(--color-err)] hover:bg-[var(--color-err)]/10'
          : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );
}

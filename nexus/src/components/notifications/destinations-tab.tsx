'use client';

/**
 * Destinations tab — table of all configured targets + create/edit/test/delete.
 *
 * Secrets never appear here: GET returns only `name`, `kind`, timestamps.
 * The edit form shows the fields as empty password boxes so an operator
 * rotating the HMAC doesn't see the old one on-screen; to confirm the
 * existing config is still working they use the per-row Test button.
 */
import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Send, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ModalShell } from '@/components/ui/modal-shell';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  useCreateDestination,
  useDeleteDestination,
  useDestinations,
  useTestDestination,
  useUpdateDestination,
} from '@/hooks/use-notifications';
import type { DestinationSummary } from '@/app/api/notifications/destinations/route';
import type { DestinationKind } from '@/lib/notifications/types';
import { DestinationForm, type DestinationFormValue } from './destination-form';

// Badge colour hint per kind so the table is scannable at a glance.
// Each kind gets the same badge variant as elsewhere in the tree.
const KIND_VARIANT: Record<DestinationKind, 'info' | 'outline' | 'success'> = {
  webhook: 'outline',
  ntfy: 'info',
  discord: 'success',
};

export function DestinationsTab() {
  const { data: destinations, isLoading, error } = useDestinations();
  const createM = useCreateDestination();
  const updateM = useUpdateDestination();
  const deleteM = useDeleteDestination();
  const testM = useTestDestination();
  const toast = useToast();

  const [formOpen, setFormOpen] = useState(false);
  // When editing, we only have the summary (no plaintext config) — the
  // form receives an "edit mode" marker so it knows to hide kind and
  // start secret fields empty.
  const [editing, setEditing] = useState<DestinationSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DestinationSummary | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | undefined>();

  function openCreate() {
    setEditing(null);
    setFormError(undefined);
    setFormOpen(true);
  }
  function openEdit(d: DestinationSummary) {
    setEditing(d);
    setFormError(undefined);
    setFormOpen(true);
  }

  function handleSubmit(value: DestinationFormValue) {
    setFormError(undefined);
    const onErr = (e: Error) => setFormError(e.message);
    if (editing) {
      updateM.mutate(
        { id: editing.id, patch: value },
        {
          onSuccess: () => {
            toast.success('Destination updated', value.name);
            setFormOpen(false);
          },
          onError: onErr,
        },
      );
    } else {
      createM.mutate(value, {
        onSuccess: () => {
          toast.success('Destination added', value.name);
          setFormOpen(false);
        },
        onError: onErr,
      });
    }
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteM.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success('Destination deleted', deleteTarget.name);
        setDeleteTarget(null);
      },
      onError: (err) => toast.error('Delete failed', err.message),
    });
  }

  function handleTest(d: DestinationSummary) {
    setTestingId(d.id);
    testM.mutate(d.id, {
      onSuccess: (result) => {
        if (result.outcome === 'sent') {
          toast.success('Test delivered', `${d.name} → HTTP ${result.status}`);
        } else {
          toast.error('Test failed', result.reason ?? `HTTP ${result.status ?? '—'}`);
        }
      },
      onError: (err) => toast.error('Test failed', err.message),
      onSettled: () => setTestingId(null),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Configure where notifications are delivered. Credentials are
          encrypted at rest with an AES-256-GCM key derived from{' '}
          <code className="text-xs">JWT_SECRET</code>; rotating that env
          variable invalidates stored secrets alongside sessions and CSRF
          tokens.
        </p>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" /> Add destination
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
        {!isLoading && !error && (!destinations || destinations.length === 0) && (
          <div className="p-10 text-center">
            <p className="text-sm text-[var(--color-fg-faint)] mb-3">
              No destinations yet — add one to start routing notifications.
            </p>
            <Button variant="secondary" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Add destination
            </Button>
          </div>
        )}
        {!isLoading && !error && destinations && destinations.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Kind</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {destinations.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-overlay)]/50 transition"
                >
                  <td className="px-4 py-3 font-medium text-[var(--color-fg)]">
                    {d.name}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={KIND_VARIANT[d.kind]}>{d.kind}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)] tabular font-mono">
                    {new Date(d.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        onClick={() => handleTest(d)}
                        disabled={testingId === d.id}
                        label="Send test notification"
                      >
                        {testingId === d.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                      </IconButton>
                      <IconButton onClick={() => openEdit(d)} label={`Edit ${d.name}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        onClick={() => setDeleteTarget(d)}
                        label={`Delete ${d.name}`}
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
        <ModalShell size="lg" onClose={() => setFormOpen(false)}>
          <h2 className="text-sm font-semibold text-[var(--color-fg)] mb-4">
            {editing ? `Edit ${editing.name}` : 'Add destination'}
          </h2>
          {editing && (
            <p className="text-xs text-[var(--color-fg-faint)] mb-4 flex items-start gap-2">
              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              The existing secret isn&rsquo;t shown for safety. Leave the
              secret fields empty to keep the stored value, or type a new
              value to rotate it.
            </p>
          )}
          <DestinationForm
            initial={editing ? {
              name: editing.name,
              // We don't have the plaintext config; seed an empty one of the
              // right kind so the form can render without the secrets.
              config: editing.kind === 'webhook' ? { kind: 'webhook', url: '' } :
                      editing.kind === 'ntfy'    ? { kind: 'ntfy', topicUrl: '' } :
                                                   { kind: 'discord', webhookUrl: '' },
            } : null}
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
          message="Any rules pointing at this destination will be deleted too. This can't be undone."
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Subtle "last test outcome" indicator at the bottom of the card —
          only visible while a test is in flight or the most recent one
          just completed. Keeps the screen calm. */}
      {testM.isSuccess && (
        <div className="text-xs text-[var(--color-ok)] flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3" />
          Last test: {testM.data?.outcome} · HTTP {testM.data?.status ?? '—'}
        </div>
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

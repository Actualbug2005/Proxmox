'use client';

/**
 * Destructive confirmation dialog for removing a federated cluster.
 *
 * Operator must type the cluster's display name exactly before the
 * Delete button activates. DELETE /api/federation/clusters/[id] via
 * useCsrfMutation.
 */
import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalShell } from '@/components/ui/modal-shell';
import { useToast } from '@/components/ui/toast';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import type { FederatedClusterView } from '@/components/federation/cluster-row';

interface RemoveDialogProps {
  cluster: FederatedClusterView;
  onClose: () => void;
}

const inputCls =
  'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50';

export function RemoveClusterDialog({ cluster, onClose }: RemoveDialogProps) {
  const toast = useToast();
  const [phrase, setPhrase] = useState('');

  const confirmed = phrase === cluster.name;

  const mutation = useCsrfMutation<unknown, void>({
    url: `/api/federation/clusters/${encodeURIComponent(cluster.id)}`,
    method: 'DELETE',
    invalidateKeys: [['federation', 'clusters']],
  });

  function submit() {
    if (!confirmed) return;
    mutation.mutate(undefined as unknown as void, {
      onSuccess: () => {
        toast.success('Cluster removed');
        onClose();
      },
      onError: (err) => toast.error('Remove failed', err.message),
    });
  }

  return (
    <ModalShell size="md" onClose={mutation.isPending ? undefined : onClose}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[var(--color-err)]" />
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">Remove cluster</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] p-1 disabled:opacity-40"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-sm text-[var(--color-fg-secondary)]">
          This will unregister <span className="font-medium text-[var(--color-fg)]">{cluster.name}</span> and
          delete its stored API token from this Nexus host. The remote cluster itself is unaffected —
          you can re-register it later.
        </p>
        <p className="text-xs text-[var(--color-fg-subtle)]">
          Type <span className="font-mono text-[var(--color-fg-secondary)]">{cluster.name}</span> to confirm.
        </p>
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder={cluster.name}
          className={cn(inputCls, 'font-mono')}
          spellCheck={false}
          autoFocus
        />

        {mutation.error && (
          <div className="flex items-start gap-2 p-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 rounded-lg text-sm">
            <X className="w-4 h-4 text-[var(--color-err)] mt-0.5 shrink-0" />
            <div className="text-[var(--color-err)]">{mutation.error.message}</div>
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-end mt-6">
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!confirmed || mutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-err)] hover:opacity-90 text-white rounded-lg transition disabled:opacity-40"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Delete
        </button>
      </div>
    </ModalShell>
  );
}

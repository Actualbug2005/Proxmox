'use client';

/**
 * Simple dialog to rotate a federated cluster's API token credentials.
 *
 * PATCHes /api/federation/clusters/[id] with { tokenId, tokenSecret }.
 * The existing secret is never returned by the API, so the user is
 * expected to paste a newly-minted token from the remote cluster's UI.
 */
import { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalShell } from '@/components/ui/modal-shell';
import { useToast } from '@/components/ui/toast';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import type { FederatedClusterView } from '@/components/federation/cluster-row';

interface RotateDialogProps {
  cluster: FederatedClusterView;
  onClose: () => void;
}

interface RotateInput {
  tokenId: string;
  tokenSecret: string;
}

const inputCls =
  'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50';

export function RotateCredentialsDialog({ cluster, onClose }: RotateDialogProps) {
  const toast = useToast();
  const [tokenId, setTokenId] = useState(cluster.tokenId);
  const [tokenSecret, setTokenSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const tokenIdValid = /^[^@]+@[^!]+![^\s!]+$/.test(tokenId.trim());
  const secretValid = tokenSecret.trim().length > 0;
  const canSubmit = tokenIdValid && secretValid;

  const mutation = useCsrfMutation<unknown, RotateInput>({
    url: `/api/federation/clusters/${encodeURIComponent(cluster.id)}`,
    method: 'PATCH',
    invalidateKeys: [['federation', 'clusters']],
  });

  function submit() {
    if (!canSubmit) return;
    mutation.mutate(
      { tokenId: tokenId.trim(), tokenSecret: tokenSecret.trim() },
      {
        onSuccess: () => {
          toast.success('Credentials rotated');
          onClose();
        },
        onError: (err) => toast.error('Rotation failed', err.message),
      },
    );
  }

  return (
    <ModalShell size="lg" onClose={mutation.isPending ? undefined : onClose}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[var(--color-fg-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">Rotate credentials</h3>
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

      <p className="text-sm text-[var(--color-fg-secondary)] mb-4">
        Paste a freshly-minted API token for{' '}
        <span className="font-medium text-[var(--color-fg)]">{cluster.name}</span>. The old
        secret is discarded atomically on save.
      </p>

      <div className="space-y-4">
        <div>
          <label className="text-xs text-[var(--color-fg-subtle)] block mb-1.5 uppercase tracking-widest">
            Token id
          </label>
          <input
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            placeholder="root@pam!nexus"
            className={cn(inputCls, 'font-mono')}
            spellCheck={false}
          />
          {!tokenIdValid && tokenId.length > 0 && (
            <p className="text-xs text-[var(--color-err)] mt-1">
              Token id must be <code>user@realm!tokenname</code>.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs text-[var(--color-fg-subtle)] block mb-1.5 uppercase tracking-widest">
            New token secret
          </label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={tokenSecret}
              onChange={(e) => setTokenSecret(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className={cn(inputCls, 'font-mono pr-10')}
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              className="absolute inset-y-0 right-0 px-3 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

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
          disabled={!canSubmit || mutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] rounded-lg transition disabled:opacity-40"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Rotate
        </button>
      </div>
    </ModalShell>
  );
}

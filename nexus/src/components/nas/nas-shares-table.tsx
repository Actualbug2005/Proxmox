'use client';

/**
 * NAS shares table. One row per NasShare returned by /api/nas/shares.
 * Delete triggers a confirmation dialog before the DELETE request fires.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { Loader2, Share2, Trash2, Lock, Unlock, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NasShare, NasProtocol } from '@/types/nas';
import { FileBrowserSheet } from './file-browser-sheet';

interface Props {
  node: string;
}

const STATUS_VARIANT: Record<NasShare['status'], 'success' | 'outline' | 'danger'> = {
  active: 'success',
  inactive: 'outline',
  error: 'danger',
};

const PROTOCOL_VARIANT: Record<NasProtocol, 'info' | 'warning'> = {
  smb: 'info',
  nfs: 'warning',
};

export function NasSharesTable({ node }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<NasShare | null>(null);
  const [activeBrowse, setActiveBrowse] = useState<NasShare | null>(null);

  const { data: shares, isLoading, error } = useQuery({
    queryKey: ['nas-shares', node],
    queryFn: () => api.nas.getShares(node),
    enabled: !!node,
    refetchInterval: POLL_INTERVALS.config,
  });

  const sorted = useMemo(
    () => [...(shares ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [shares],
  );

  const deleteM = useMutation({
    mutationFn: (id: string) => api.nas.deleteShare(node, id),
    onSuccess: () => {
      toast.success('Share deleted', pendingDelete?.name ?? '');
      qc.invalidateQueries({ queryKey: ['nas-shares', node] });
      qc.invalidateQueries({ queryKey: ['nas-services', node] });
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error('Delete failed', err instanceof Error ? err.message : String(err));
      setPendingDelete(null);
    },
  });

  return (
    <>
      {activeBrowse && (
        <FileBrowserSheet
          node={node}
          shareId={activeBrowse.id}
          shareName={activeBrowse.name}
          onClose={() => setActiveBrowse(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete share "${pendingDelete.name}"?`}
          message={`Removes the ${pendingDelete.protocols.join(' + ').toUpperCase()} export of ${pendingDelete.path} on ${node}. Files at the path are preserved.`}
          danger
          onConfirm={() => deleteM.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {error && (
        <div className="text-sm text-[var(--color-err)] px-4 py-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg">
          Failed to list shares: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className="studio-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] flex items-center gap-2">
          <Share2 className="w-4 h-4 text-[var(--color-fg-subtle)]" />
          <span className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Shares {sorted.length > 0 && `(${sorted.length})`}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-faint)] py-10 text-center">
            No shares on {node} yet.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium">Name</th>
                <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium">Path</th>
                <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium">Protocols</th>
                <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium">Access</th>
                <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium">Status</th>
                <th className="text-right px-4 py-3 text-[var(--color-fg-subtle)] font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-[var(--color-fg-secondary)] font-medium">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-[var(--color-fg-muted)] break-all">{s.path}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {s.protocols.map((p) => (
                        <Badge key={p} variant={PROTOCOL_VARIANT[p]}>
                          {p.toUpperCase()}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs',
                        s.readOnly ? 'text-[var(--color-fg-muted)]' : 'text-[var(--color-ok)]',
                      )}
                    >
                      {s.readOnly ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      {s.readOnly ? 'Read-only' : 'Read/Write'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setActiveBrowse(s)}
                        aria-label={`Browse ${s.name}`}
                        className="p-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-white/5 rounded-md transition"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPendingDelete(s)}
                        disabled={deleteM.isPending}
                        aria-label={`Delete ${s.name}`}
                        className="p-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-err)] hover:bg-[var(--color-err)]/10 rounded-md transition disabled:opacity-40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

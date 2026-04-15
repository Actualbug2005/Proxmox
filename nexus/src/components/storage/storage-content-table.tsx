'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { Trash2, Loader2, Package } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { useState } from 'react';
import type { StorageContent } from '@/types/proxmox';

interface StorageContentTableProps {
  node: string;
  storage: string;
  items: StorageContent[] | undefined;
  isLoading: boolean;
  onAfterDelete?: () => void;
  /** Override the empty-state text for context (e.g., "no ISOs yet" vs generic) */
  emptyTitle?: string;
  emptyDescription?: string;
}

function volidName(volid: string): string {
  const idx = volid.indexOf(':');
  return idx >= 0 ? volid.slice(idx + 1) : volid;
}

function formatTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

export function StorageContentTable({
  node,
  storage,
  items,
  isLoading,
  onAfterDelete,
  emptyTitle = 'No content here yet',
  emptyDescription,
}: StorageContentTableProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const deleteM = useMutation({
    mutationFn: (volid: string) => api.storage.deleteContent(node, storage, volid),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['storage-content', node, storage] });
      onAfterDelete?.();
      toast.success('File deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <>
      {deleteTarget && (
        <ConfirmDialog
          title="Delete file?"
          message={`Permanently delete ${volidName(deleteTarget)} from ${storage}?`}
          danger
          onConfirm={() => deleteM.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Name</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Type</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Format</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">VMID</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Size</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Created</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.volid} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                <td className="px-4 py-2 font-mono text-gray-200 text-xs break-all max-w-xs" title={item.volid}>
                  {volidName(item.volid)}
                </td>
                <td className="px-4 py-2">
                  <Badge variant="outline" className="text-xs">{item.content}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">{item.format ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-500 font-mono">{item.vmid ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-400 text-right tabular-nums">
                  {item.size ? formatBytes(item.size) : '—'}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">{formatTime(item.ctime)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => setDeleteTarget(item.volid)}
                    disabled={deleteM.isPending}
                    className="p-1.5 text-red-400 hover:text-red-300 hover:bg-gray-800 rounded-lg transition disabled:opacity-40"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

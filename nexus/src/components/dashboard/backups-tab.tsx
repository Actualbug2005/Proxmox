'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { RestoreDialog } from '@/components/storage/restore-dialog';
import {
  Archive, Loader2, Trash2, Lock, Undo2, X,
} from 'lucide-react';
import { formatBytes, cn } from '@/lib/utils';
import type { BackupFilePublic, BackupCompress, BackupMode, VzdumpParamsPublic, PVEStoragePublic } from '@/types/proxmox';

type Kind = 'qemu' | 'lxc';

interface BackupsTabProps {
  kind: Kind;
  node: string;
  vmid: number;
}

function formatTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function BackupNowDialog({
  kind, node, vmid, onClose, onComplete,
}: {
  kind: Kind;
  node: string;
  vmid: number;
  onClose: () => void;
  onComplete: () => void;
}) {
  const toast = useToast();
  const { data: storages } = useQuery({
    queryKey: ['storage', node, 'list'],
    queryFn: () => api.storage.list(node),
  });

  const backupStorages = (storages ?? []).filter((s: PVEStoragePublic) => s.active && s.content?.split(',').includes('backup'));

  const [storage, setStorage] = useState('');
  const [mode, setMode] = useState<BackupMode>('snapshot');
  const [compress, setCompress] = useState<BackupCompress>('zstd');
  const [notes, setNotes] = useState('');
  const [markProtected, setMarkProtected] = useState(false);

  useEffect(() => {
    if (!storage && backupStorages.length > 0) setStorage(backupStorages[0].storage);
  }, [backupStorages, storage]);

  const backupM = useMutation({
    mutationFn: (params: VzdumpParamsPublic) => api.backups.vzdump(node, params),
    onSuccess: (upid) => {
      toast.success('Backup queued', upid.slice(0, 48));
      onComplete();
    },
    onError: (err) => toast.error('Backup failed', err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    if (!storage) return;
    backupM.mutate({
      vmid,
      storage,
      mode,
      compress,
      ...(notes ? { 'notes-template': notes } : {}),
      ...(markProtected ? { protected: true } : {}),
    });
  };

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Back up {kind === 'qemu' ? 'VM' : 'CT'} {vmid}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Storage</label>
            <select value={storage} onChange={(e) => setStorage(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {backupStorages.map((s) => (
                <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as BackupMode)} className={inputCls}>
              <option value="snapshot">Snapshot (live, minimal downtime)</option>
              <option value="suspend">Suspend (pause, consistent)</option>
              <option value="stop">Stop (full shutdown)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Compression</label>
            <select value={compress} onChange={(e) => setCompress(e.target.value as BackupCompress)} className={inputCls}>
              <option value="zstd">zstd (fast, good ratio)</option>
              <option value="gzip">gzip</option>
              <option value="lzo">lzo (fastest)</option>
              <option value="0">none</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Notes template (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Pre-upgrade {{guestname}}"
              className={inputCls}
            />
            <p className="text-xs text-zinc-600 mt-1">{'PVE template vars: {{guestname}} {{node}} {{vmid}}'}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={markProtected} onChange={(e) => setMarkProtected(e.target.checked)} className="rounded border-gray-600" />
            Mark backup as protected (prevents automatic prune)
          </label>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={backupM.isPending} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!storage || backupM.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-100 hover:bg-white text-white rounded-lg transition disabled:opacity-40"
          >
            {backupM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
            Back up now
          </button>
        </div>
      </div>
    </div>
  );
}

function volidName(volid: string): string {
  const idx = volid.indexOf(':');
  return idx >= 0 ? volid.slice(idx + 1) : volid;
}

function volidStorage(volid: string): string {
  const idx = volid.indexOf(':');
  return idx >= 0 ? volid.slice(0, idx) : '';
}

export function BackupsTab({ kind, node, vmid }: BackupsTabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showBackupNow, setShowBackupNow] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupFilePublic | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupFilePublic | null>(null);

  const { data: storages } = useQuery({
    queryKey: ['storage', node, 'list'],
    queryFn: () => api.storage.list(node),
  });
  const backupStorages = (storages ?? []).filter((s: PVEStoragePublic) => s.active && s.content?.split(',').includes('backup'));

  const fileQueries = useQueries({
    queries: backupStorages.map((s) => ({
      queryKey: ['backups', 'files', node, s.storage],
      queryFn: () => api.backups.files(node, s.storage),
      refetchInterval: 30_000,
    })),
  });

  const isLoading = fileQueries.some((q) => q.isLoading);
  const files: BackupFilePublic[] = fileQueries
    .flatMap((q) => q.data ?? [])
    .filter((f) => f.vmid === vmid)
    .sort((a, b) => b.ctime - a.ctime);

  const invalidate = () => {
    backupStorages.forEach((s) =>
      qc.invalidateQueries({ queryKey: ['backups', 'files', node, s.storage] }),
    );
  };

  const deleteM = useMutation({
    mutationFn: (f: BackupFilePublic) => api.backups.delete(node, volidStorage(f.volid), f.volid),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
      toast.success('Backup deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const protectM = useMutation({
    mutationFn: (p: { f: BackupFilePublic; next: boolean }) =>
      api.backups.protect(node, volidStorage(p.f.volid), p.f.volid, p.next),
    onSuccess: (_, vars) => {
      invalidate();
      toast.success(vars.next ? 'Backup protected' : 'Protection removed');
    },
    onError: (err) => toast.error('Update failed', err instanceof Error ? err.message : String(err)),
  });

  return (
    <>
      {showBackupNow && (
        <BackupNowDialog
          kind={kind}
          node={node}
          vmid={vmid}
          onClose={() => setShowBackupNow(false)}
          onComplete={() => {
            setShowBackupNow(false);
            invalidate();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete backup?"
          message={`Permanently delete ${volidName(deleteTarget.volid)}?`}
          danger
          onConfirm={() => deleteM.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {restoreTarget && (
        <RestoreDialog
          backup={restoreTarget}
          node={node}
          storage={volidStorage(restoreTarget.volid)}
          onClose={() => setRestoreTarget(null)}
          onComplete={invalidate}
        />
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-300">
            {files.length} backup{files.length !== 1 ? 's' : ''} for this {kind === 'qemu' ? 'VM' : 'CT'}
          </p>
          <button
            onClick={() => setShowBackupNow(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 hover:bg-white text-white text-sm rounded-lg transition"
          >
            <Archive className="w-4 h-4" />
            Back up now
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="No backups yet"
            description="Use 'Back up now' to create a one-off vzdump, or schedule recurring backups from Cluster → Backups."
          />
        ) : (
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800/60">
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Archive</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Storage</th>
                  <th className="text-right px-4 py-3 text-xs text-zinc-500 font-medium">Size</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Created</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Flags</th>
                  <th className="text-right px-4 py-3 text-xs text-zinc-500 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.volid} className="border-b border-zinc-800/60/40 hover:bg-zinc-800/20">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-200 break-all max-w-xs" title={f.volid}>
                      {volidName(f.volid)}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400 font-mono">{volidStorage(f.volid)}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400 text-right tabular-nums">
                      {f.size ? formatBytes(f.size) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{formatTime(f.ctime)}</td>
                    <td className="px-4 py-3 space-x-1">
                      {f.protected ? (
                        <Badge variant="warning" className="text-xs inline-flex items-center gap-1">
                          <Lock className="w-3 h-3" /> protected
                        </Badge>
                      ) : null}
                      {f.verification?.state === 'ok' && <Badge variant="success" className="text-xs">verified</Badge>}
                      {f.verification?.state === 'failed' && <Badge variant="danger" className="text-xs">verify failed</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => setRestoreTarget(f)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-blue-400 hover:text-blue-300 bg-zinc-800 hover:bg-zinc-800 rounded-lg transition"
                          title="Restore"
                        >
                          <Undo2 className="w-3 h-3" />
                          Restore
                        </button>
                        <button
                          onClick={() => protectM.mutate({ f, next: !f.protected })}
                          disabled={protectM.isPending}
                          className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-800 rounded-lg transition disabled:opacity-40',
                            f.protected ? 'text-yellow-400' : 'text-zinc-400',
                          )}
                          title={f.protected ? 'Unprotect' : 'Protect'}
                        >
                          <Lock className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(f)}
                          disabled={!!f.protected || deleteM.isPending}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-red-400 hover:text-red-300 bg-zinc-800 hover:bg-zinc-800 rounded-lg transition disabled:opacity-40"
                          title={f.protected ? 'Unprotect before delete' : 'Delete'}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

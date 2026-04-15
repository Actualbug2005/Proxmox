'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { TabBar } from '@/components/dashboard/tab-bar';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { RestoreDialog } from '@/components/storage/restore-dialog';
import { BackupJobEditor } from '@/components/backups/backup-job-editor';
import { Archive, Plus, Trash2, Loader2, Lock, Undo2, Pencil, CalendarClock } from 'lucide-react';
import { formatBytes, cn } from '@/lib/utils';
import type { BackupFile, BackupJob, PVEStorage } from '@/types/proxmox';

type Tab = 'archive' | 'jobs';

function volidName(volid: string): string {
  const idx = volid.indexOf(':');
  return idx >= 0 ? volid.slice(idx + 1) : volid;
}
function volidStorage(volid: string): string {
  const idx = volid.indexOf(':');
  return idx >= 0 ? volid.slice(0, idx) : '';
}
function formatTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

interface FileWithLocation extends BackupFile {
  _node: string;
}

export default function BackupsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('archive');

  const { data: resources } = useQuery({ queryKey: ['cluster', 'resources'], queryFn: () => api.cluster.resources() });
  const nodes = useMemo(
    () => (resources ?? []).filter((r) => r.type === 'node').map((n) => n.node ?? n.id ?? ''),
    [resources],
  );

  // Fan out per (node, storage) — load all storages per node, then per storage that supports 'backup'.
  const storageQueries = useQueries({
    queries: nodes.map((node) => ({
      queryKey: ['storage', node, 'list'],
      queryFn: () => api.storage.list(node),
    })),
  });

  const nodeStoragePairs = useMemo(() => {
    const pairs: { node: string; storage: string }[] = [];
    nodes.forEach((node, idx) => {
      const storages = storageQueries[idx]?.data as PVEStorage[] | undefined;
      (storages ?? [])
        .filter((s) => s.active && s.content?.split(',').includes('backup'))
        .forEach((s) => pairs.push({ node, storage: s.storage }));
    });
    // dedupe on storage name (shared storages appear on every node)
    const seen = new Set<string>();
    return pairs.filter((p) => {
      const key = p.storage;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [nodes, storageQueries]);

  const fileQueries = useQueries({
    queries: nodeStoragePairs.map(({ node, storage }) => ({
      queryKey: ['backups', 'files', node, storage],
      queryFn: () => api.backups.files(node, storage),
      refetchInterval: 30_000,
    })),
  });

  const loadingArchive = fileQueries.some((q) => q.isLoading);
  const files: FileWithLocation[] = useMemo(() => {
    const out: FileWithLocation[] = [];
    fileQueries.forEach((q, idx) => {
      const pair = nodeStoragePairs[idx];
      (q.data ?? []).forEach((f) => out.push({ ...f, _node: pair.node }));
    });
    return out.sort((a, b) => b.ctime - a.ctime);
  }, [fileQueries, nodeStoragePairs]);

  const invalidateArchive = () => {
    nodeStoragePairs.forEach(({ node, storage }) =>
      qc.invalidateQueries({ queryKey: ['backups', 'files', node, storage] }),
    );
  };

  const { data: jobs, isLoading: loadingJobs } = useQuery({
    queryKey: ['backups', 'jobs'],
    queryFn: () => api.backups.jobs.list(),
    refetchInterval: 30_000,
  });

  const [deleteTarget, setDeleteTarget] = useState<FileWithLocation | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<FileWithLocation | null>(null);
  const [editJob, setEditJob] = useState<BackupJob | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [deleteJob, setDeleteJob] = useState<BackupJob | null>(null);

  const deleteFileM = useMutation({
    mutationFn: (f: FileWithLocation) => api.backups.delete(f._node, volidStorage(f.volid), f.volid),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateArchive();
      toast.success('Backup deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const protectM = useMutation({
    mutationFn: (p: { f: FileWithLocation; next: boolean }) =>
      api.backups.protect(p.f._node, volidStorage(p.f.volid), p.f.volid, p.next),
    onSuccess: (_, vars) => {
      invalidateArchive();
      toast.success(vars.next ? 'Backup protected' : 'Protection removed');
    },
    onError: (err) => toast.error('Update failed', err instanceof Error ? err.message : String(err)),
  });

  const deleteJobM = useMutation({
    mutationFn: (j: BackupJob) => api.backups.jobs.delete(j.id),
    onSuccess: () => {
      setDeleteJob(null);
      qc.invalidateQueries({ queryKey: ['backups', 'jobs'] });
      toast.success('Job deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const tabs = [
    { id: 'archive' as const, label: 'Archive', count: files.length },
    { id: 'jobs' as const, label: 'Jobs', count: jobs?.length },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Backups</h1>
        <p className="text-sm text-gray-500">Backup archive and scheduled jobs across the cluster</p>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete backup?"
          message={`Permanently delete ${volidName(deleteTarget.volid)} from ${volidStorage(deleteTarget.volid)}?`}
          danger
          onConfirm={() => deleteFileM.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {restoreTarget && (
        <RestoreDialog
          backup={restoreTarget}
          node={restoreTarget._node}
          storage={volidStorage(restoreTarget.volid)}
          onClose={() => setRestoreTarget(null)}
          onComplete={invalidateArchive}
        />
      )}
      {deleteJob && (
        <ConfirmDialog
          title={`Delete job "${deleteJob.id}"?`}
          message="The schedule will be removed. Existing backup files are not affected."
          danger
          onConfirm={() => deleteJobM.mutate(deleteJob)}
          onCancel={() => setDeleteJob(null)}
        />
      )}
      {(editJob || showNewJob) && (
        <BackupJobEditor
          initial={editJob}
          onClose={() => {
            setEditJob(null);
            setShowNewJob(false);
          }}
          onSaved={() => {
            setEditJob(null);
            setShowNewJob(false);
            qc.invalidateQueries({ queryKey: ['backups', 'jobs'] });
          }}
        />
      )}

      <TabBar tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'archive' && (
        loadingArchive ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
        ) : files.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="No backups found"
            description="Create a one-off backup from a VM/CT detail page's Backups tab, or schedule recurring backups in the Jobs tab."
          />
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Archive</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">VMID</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Node</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Storage</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Size</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Created</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Flags</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.volid + f._node} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="px-4 py-2 font-mono text-xs text-gray-200 break-all max-w-xs" title={f.volid}>
                      {volidName(f.volid)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">{f.vmid ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-400 font-mono">{f._node}</td>
                    <td className="px-4 py-2 text-xs text-gray-400 font-mono">{volidStorage(f.volid)}</td>
                    <td className="px-4 py-2 text-xs text-gray-400 text-right tabular-nums">{f.size ? formatBytes(f.size) : '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{formatTime(f.ctime)}</td>
                    <td className="px-4 py-2 space-x-1">
                      {f.protected ? <Badge variant="warning" className="text-xs inline-flex items-center gap-1"><Lock className="w-3 h-3" /> protected</Badge> : null}
                      {f.verification?.state === 'ok' && <Badge variant="success" className="text-xs">verified</Badge>}
                      {f.verification?.state === 'failed' && <Badge variant="danger" className="text-xs">verify failed</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => setRestoreTarget(f)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-blue-400 hover:text-blue-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
                          title="Restore"
                        >
                          <Undo2 className="w-3 h-3" /> Restore
                        </button>
                        <button
                          onClick={() => protectM.mutate({ f, next: !f.protected })}
                          disabled={protectM.isPending}
                          className={cn('p-1 text-xs bg-gray-800 hover:bg-gray-700 rounded-lg transition disabled:opacity-40', f.protected ? 'text-yellow-400' : 'text-gray-400')}
                          title={f.protected ? 'Unprotect' : 'Protect'}
                        >
                          <Lock className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(f)}
                          disabled={!!f.protected || deleteFileM.isPending}
                          className="p-1 text-xs text-red-400 hover:text-red-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition disabled:opacity-40"
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
        )
      )}

      {tab === 'jobs' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewJob(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              New job
            </button>
          </div>

          {loadingJobs ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
          ) : !jobs || jobs.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No scheduled jobs yet"
              description="Create a job to run backups on a schedule across nodes, pools, or specific VMIDs."
            />
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">ID</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Schedule</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Target</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Storage</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Mode</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Status</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="px-4 py-2 font-mono text-xs text-gray-200">{j.id}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-400">{j.schedule}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">
                        {j.all ? 'All guests' : j.vmid ? `VMIDs: ${j.vmid}` : j.pool ? `pool ${j.pool}` : '—'}
                        {j.node && <span className="text-gray-600"> on {j.node}</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-400 font-mono">{j.storage}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">{j.mode}</td>
                      <td className="px-4 py-2">
                        {j.enabled === 0 ? (
                          <Badge variant="outline" className="text-xs">disabled</Badge>
                        ) : (
                          <Badge variant="success" className="text-xs">enabled</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => setEditJob(j)}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition"
                            title="Edit"
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                          <button
                            onClick={() => setDeleteJob(j)}
                            className="p-1 text-xs text-red-400 hover:text-red-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
                            title="Delete"
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
      )}
    </div>
  );
}

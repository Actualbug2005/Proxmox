'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useDefaultNode } from '@/hooks/use-cluster';
import { useToast } from '@/components/ui/toast';
import { CronInput } from '@/components/dashboard/cron-input';
import { Loader2, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BackupJobPublic, BackupJobParamsPublic, BackupMode, BackupCompress, PVEStoragePublic } from '@/types/proxmox';

interface BackupJobEditorProps {
  initial?: BackupJobPublic | null;
  onClose: () => void;
  onSaved: () => void;
}

export function BackupJobEditor({ initial, onClose, onSaved }: BackupJobEditorProps) {
  const toast = useToast();
  const isEdit = !!initial;

  const [schedule, setSchedule] = useState(initial?.schedule ?? '0 2 * * *');
  const [enabled, setEnabled] = useState(initial?.enabled !== false);
  const [storage, setStorage] = useState(initial?.storage ?? '');
  const [node, setNode] = useState(initial?.node ?? '');
  const [mode, setMode] = useState<BackupMode>(initial?.mode ?? 'snapshot');
  const [compress, setCompress] = useState<BackupCompress>(initial?.compress ?? 'zstd');
  const [vmid, setVmid] = useState(initial?.vmid ?? '');
  const [all, setAll] = useState(initial?.all ?? false);
  const [pool, setPool] = useState(initial?.pool ?? '');
  const [mailto, setMailto] = useState(initial?.mailto ?? '');
  const [mailnotification, setMailnotification] = useState<'always' | 'failure'>(initial?.mailnotification ?? 'failure');
  const [notesTemplate, setNotesTemplate] = useState(initial?.['notes-template'] ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [pruneBackups, setPruneBackups] = useState(initial?.['prune-backups'] ?? '');

  const { data: resources } = useQuery({ queryKey: ['cluster', 'resources'], queryFn: () => api.cluster.resources() });
  const nodes = (resources ?? []).filter((r) => r.type === 'node');
  const defaultNode = useDefaultNode();

  // Seed the node field with the local/main node on first render of a new job.
  useEffect(() => {
    if (!isEdit && !node && defaultNode) setNode(defaultNode);
  }, [isEdit, node, defaultNode]);

  const effectiveNode = node || defaultNode || nodes[0]?.node;
  const { data: storages } = useQuery({
    queryKey: ['storage', effectiveNode, 'list'],
    queryFn: () => api.storage.list(effectiveNode ?? ''),
    enabled: !!effectiveNode,
  });
  const backupStorages = (storages ?? []).filter((s: PVEStoragePublic) => s.content?.split(',').includes('backup'));

  useEffect(() => {
    if (!storage && backupStorages.length > 0) setStorage(backupStorages[0].storage);
  }, [backupStorages, storage]);

  const saveM = useMutation({
    mutationFn: (params: BackupJobParamsPublic) =>
      isEdit && initial ? api.backups.jobs.update(initial.id, params) : api.backups.jobs.create(params),
    onSuccess: () => {
      toast.success(isEdit ? 'Job updated' : 'Job created');
      onSaved();
    },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    const params: BackupJobParamsPublic = {
      schedule,
      enabled,
      storage,
      mode,
      compress,
      mailnotification,
      ...(node ? { node } : {}),
      ...(all ? { all: true } : vmid ? { vmid } : {}),
      ...(pool ? { pool } : {}),
      ...(mailto ? { mailto } : {}),
      ...(notesTemplate ? { 'notes-template': notesTemplate } : {}),
      ...(comment ? { comment } : {}),
      ...(pruneBackups ? { 'prune-backups': pruneBackups } : {}),
    };
    saveM.mutate(params);
  };

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit backup job' : 'New backup job'}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Schedule</label>
            <CronInput value={schedule} onChange={setSchedule} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Node (optional)</label>
              <select value={node} onChange={(e) => setNode(e.target.value)} className={inputCls}>
                <option value="">All nodes</option>
                {nodes.map((n) => (
                  <option key={n.node} value={n.node}>{n.node}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Storage</label>
              <select value={storage} onChange={(e) => setStorage(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {backupStorages.map((s) => (
                  <option key={s.storage} value={s.storage}>{s.storage}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Targets</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="rounded border-gray-600" />
                All guests on the selected node(s)
              </label>
              {!all && (
                <>
                  <input
                    value={vmid}
                    onChange={(e) => setVmid(e.target.value)}
                    placeholder="Comma-separated VMIDs (e.g. 100,101,200)"
                    className={inputCls}
                  />
                  <input
                    value={pool}
                    onChange={(e) => setPool(e.target.value)}
                    placeholder="Or a pool name"
                    className={inputCls}
                  />
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as BackupMode)} className={inputCls}>
                <option value="snapshot">Snapshot</option>
                <option value="suspend">Suspend</option>
                <option value="stop">Stop</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Compression</label>
              <select value={compress} onChange={(e) => setCompress(e.target.value as BackupCompress)} className={inputCls}>
                <option value="zstd">zstd</option>
                <option value="gzip">gzip</option>
                <option value="lzo">lzo</option>
                <option value="0">none</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Mail to (optional)</label>
              <input value={mailto} onChange={(e) => setMailto(e.target.value)} placeholder="admin@example.com" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">When</label>
              <select value={mailnotification} onChange={(e) => setMailnotification(e.target.value as 'always' | 'failure')} className={inputCls}>
                <option value="failure">on failure</option>
                <option value="always">always</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Notes template (optional)</label>
            <input
              value={notesTemplate}
              onChange={(e) => setNotesTemplate(e.target.value)}
              placeholder="{{guestname}} {{vmid}}"
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Prune schedule (optional)</label>
            <input
              value={pruneBackups}
              onChange={(e) => setPruneBackups(e.target.value)}
              placeholder="keep-last=7,keep-weekly=4,keep-monthly=6"
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-gray-600" />
            Enabled
          </label>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={saveM.isPending} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!storage || saveM.isPending}
            className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-300 hover:bg-zinc-200 text-zinc-900 rounded-lg transition disabled:opacity-40')}
          >
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create job'}
          </button>
        </div>
      </div>
    </div>
  );
}

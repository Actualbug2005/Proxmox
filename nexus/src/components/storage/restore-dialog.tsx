'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { Loader2, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BackupFilePublic, RestoreParamsPublic } from '@/types/proxmox';

interface RestoreDialogProps {
  backup: BackupFilePublic;
  node: string;
  storage: string;
  onClose: () => void;
  onComplete?: () => void;
}

export function RestoreDialog({ backup, node, storage, onClose, onComplete }: RestoreDialogProps) {
  const toast = useToast();
  const [targetVmid, setTargetVmid] = useState<number | ''>('');
  const [unique, setUnique] = useState(true);
  const [start, setStart] = useState(false);
  const [force, setForce] = useState(false);
  const [targetStorage, setTargetStorage] = useState(storage);

  const kind: 'qemu' | 'lxc' = backup.subtype === 'lxc' ? 'lxc' : 'qemu';

  const { data: nextid } = useQuery({ queryKey: ['cluster', 'nextid'], queryFn: () => api.cluster.nextid() });
  const { data: storages } = useQuery({
    queryKey: ['storage', node, 'list'],
    queryFn: () => api.storage.list(node),
  });
  const writableStorages = (storages ?? []).filter(
    (s) => s.active && s.content?.split(',').includes(kind === 'qemu' ? 'images' : 'rootdir'),
  );

  useEffect(() => {
    if (targetVmid === '' && typeof nextid === 'number') setTargetVmid(nextid);
  }, [nextid, targetVmid]);

  const restoreM = useMutation({
    mutationFn: (params: RestoreParamsPublic) =>
      kind === 'qemu'
        ? api.backups.restoreVM(node, params)
        : api.backups.restoreCT(node, params),
    onSuccess: () => {
      toast.success(`Restore queued to ${kind === 'qemu' ? 'VM' : 'CT'} ${targetVmid}`, 'Track progress on the Tasks page.');
      onComplete?.();
      onClose();
    },
    onError: (err) => toast.error('Restore failed', err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    if (typeof targetVmid !== 'number') return;
    restoreM.mutate({
      vmid: targetVmid,
      archive: backup.volid,
      storage: targetStorage,
      force,
      unique,
      start,
    });
  };

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Restore backup</h3>
            <p className="text-xs text-zinc-500 mt-0.5 font-mono break-all">{backup.volid}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Target VMID</label>
            <input
              type="number"
              value={targetVmid}
              onChange={(e) => setTargetVmid(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={String(nextid ?? '')}
              className={inputCls}
            />
            <p className="text-xs text-zinc-600 mt-1">Restores as a new {kind === 'qemu' ? 'VM' : 'CT'}; defaults to the next free ID.</p>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Target storage</label>
            <select value={targetStorage} onChange={(e) => setTargetStorage(e.target.value)} className={inputCls}>
              {writableStorages.map((s) => (
                <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>
              ))}
            </select>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} className="rounded border-gray-600" />
              Assign unique MAC / UUID (recommended)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} className="rounded border-gray-600" />
              Start after restore
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="rounded border-gray-600" />
              Overwrite existing VMID if it exists
            </label>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={restoreM.isPending} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={restoreM.isPending || typeof targetVmid !== 'number' || !targetStorage}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition text-zinc-900',
              'bg-zinc-300 hover:bg-zinc-200 disabled:opacity-40',
            )}
          >
            {restoreM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { Loader2, ArrowRightLeft, X } from 'lucide-react';
import type { HAResource } from '@/types/proxmox';

interface HAMigrateDialogProps {
  resource: HAResource;
  kind: 'migrate' | 'relocate';
  onClose: () => void;
  onComplete: () => void;
}

export function HAMigrateDialog({ resource, kind, onClose, onComplete }: HAMigrateDialogProps) {
  const toast = useToast();
  const { data: status } = useQuery({ queryKey: ['cluster', 'status'], queryFn: () => api.cluster.status() });
  const nodes = (status ?? []).filter((s) => s.type === 'node' && (s.online ?? false));

  const [target, setTarget] = useState('');

  const migrateM = useMutation({
    mutationFn: () => (kind === 'migrate' ? api.ha.resources.migrate(resource.sid, target) : api.ha.resources.relocate(resource.sid, target)),
    onSuccess: () => {
      toast.success(`${kind === 'migrate' ? 'Migrate' : 'Relocate'} queued`, `${resource.sid} → ${target}`);
      onComplete();
      onClose();
    },
    onError: (err) => toast.error(`${kind} failed`, err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">
            {kind === 'migrate' ? 'Migrate' : 'Relocate'} {resource.sid}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          {kind === 'migrate'
            ? 'Online migration — guest stays running during the move. Not all storage types support this.'
            : 'Relocate — HA stops the guest, moves it, and starts it on the target node. Incurs downtime.'}
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Target node</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50">
              <option value="">Select a node…</option>
              {nodes.map((n) => (
                <option key={n.name} value={n.name}>{n.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={migrateM.isPending} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40">Cancel</button>
          <button
            onClick={() => migrateM.mutate()}
            disabled={!target || migrateM.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-300 hover:bg-zinc-200 text-zinc-900 rounded-lg transition disabled:opacity-40"
          >
            {migrateM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
            {kind === 'migrate' ? 'Migrate' : 'Relocate'}
          </button>
        </div>
      </div>
    </div>
  );
}

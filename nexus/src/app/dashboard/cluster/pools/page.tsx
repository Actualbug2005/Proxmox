'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  FolderTree, Plus, Pencil, Trash2, Loader2, Save, X, Server, Monitor, Box, HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PVEPool, PoolParams } from '@/types/proxmox';

export default function PoolsPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: pools, isLoading } = useQuery({
    queryKey: ['pools'],
    queryFn: () => api.pools.list(),
    refetchInterval: 30_000,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [edit, setEdit] = useState<PVEPool | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PVEPool | null>(null);

  const deleteM = useMutation({
    mutationFn: (p: PVEPool) => api.pools.delete(p.poolid),
    onSuccess: (_, p) => {
      setDeleteTarget(null);
      if (selected === p.poolid) setSelected(null);
      qc.invalidateQueries({ queryKey: ['pools'] });
      toast.success('Pool deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const selectedPool = pools?.find((p) => p.poolid === selected) ?? null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Pools</h1>
          <p className="text-sm text-gray-500">Resource pools group VMs, CTs, and storages for ACL scoping</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> New pool
        </button>
      </div>

      {deleteTarget && (
        deleteTarget.members && deleteTarget.members.length > 0 ? (
          <ConfirmDialog
            title={`"${deleteTarget.poolid}" has members`}
            message={`${deleteTarget.members.length} member(s) still reference this pool. Remove them first, then delete.`}
            onConfirm={() => setDeleteTarget(null)}
            onCancel={() => setDeleteTarget(null)}
          />
        ) : (
          <ConfirmDialog
            title={`Delete pool "${deleteTarget.poolid}"?`}
            message="The pool's ACL entries are removed. Member resources are unaffected."
            danger
            onConfirm={() => deleteM.mutate(deleteTarget)}
            onCancel={() => setDeleteTarget(null)}
          />
        )
      )}

      {(showNew || edit) && (
        <PoolEditor
          initial={edit}
          onClose={() => { setShowNew(false); setEdit(null); }}
          onSaved={() => { setShowNew(false); setEdit(null); qc.invalidateQueries({ queryKey: ['pools'] }); }}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
      ) : !pools || pools.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No pools yet"
          description="Create a pool to group VMs, CTs, and storages. Pools are useful for granting access to multiple resources in one ACL entry."
        />
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          <div className="space-y-2">
            {pools.map((p) => (
              <button
                key={p.poolid}
                onClick={() => setSelected(p.poolid)}
                className={cn(
                  'w-full text-left bg-gray-900 border rounded-xl p-3 transition',
                  selected === p.poolid ? 'border-orange-500/50' : 'border-gray-800 hover:border-gray-700',
                )}
              >
                <div className="flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-gray-500" />
                  <span className="font-mono text-sm text-gray-200 flex-1">{p.poolid}</span>
                  {p.members && p.members.length > 0 && (
                    <Badge variant="outline" className="text-xs">{p.members.length}</Badge>
                  )}
                </div>
                {p.comment && <p className="text-xs text-gray-500 mt-1 pl-6 truncate">{p.comment}</p>}
              </button>
            ))}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            {selectedPool ? (
              <PoolDetail
                pool={selectedPool}
                onEdit={() => setEdit(selectedPool)}
                onDelete={() => setDeleteTarget(selectedPool)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-gray-600 gap-2">
                <FolderTree className="w-8 h-8" />
                <p className="text-sm">Select a pool to view its members</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PoolEditor({ initial, onClose, onSaved }: { initial: PVEPool | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!initial;
  const [poolid, setPoolid] = useState(initial?.poolid ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');

  const saveM = useMutation({
    mutationFn: (params: PoolParams) =>
      isEdit && initial ? api.pools.update(initial.poolid, { comment: params.comment }) : api.pools.create(params),
    onSuccess: () => { toast.success(isEdit ? 'Pool updated' : 'Pool created'); onSaved(); },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit pool' : 'New pool'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Pool ID</label>
            <input value={poolid} onChange={(e) => setPoolid(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} disabled={isEdit} className={inputCls + (isEdit ? ' opacity-60' : '')} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition">Cancel</button>
          <button
            onClick={() => saveM.mutate({ poolid, ...(comment ? { comment } : {}) })}
            disabled={!poolid || saveM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
          >
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PoolDetail({ pool, onEdit, onDelete }: { pool: PVEPool; onEdit: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  // Fetch detailed pool (with members) — list endpoint may not include them
  const { data: detailed } = useQuery({
    queryKey: ['pool', pool.poolid],
    queryFn: () => api.pools.get(pool.poolid),
    refetchInterval: 30_000,
  });
  const { data: resources } = useQuery({ queryKey: ['cluster', 'resources'], queryFn: () => api.cluster.resources() });

  const members = detailed?.members ?? pool.members ?? [];
  const memberIds = new Set(members.map((m) => m.id));

  // Candidates not yet in pool
  const candidates = (resources ?? []).filter((r) =>
    (r.type === 'qemu' || r.type === 'lxc' || r.type === 'storage') && !memberIds.has(r.id),
  );

  const [selectedType, setSelectedType] = useState<'qemu' | 'lxc' | 'storage'>('qemu');
  const [addTarget, setAddTarget] = useState('');

  const addM = useMutation({
    mutationFn: (params: { vms?: string; storage?: string }) => api.pools.update(pool.poolid, params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pool', pool.poolid] });
      qc.invalidateQueries({ queryKey: ['pools'] });
      setAddTarget('');
      toast.success('Added to pool');
    },
    onError: (err) => toast.error('Add failed', err instanceof Error ? err.message : String(err)),
  });

  const removeM = useMutation({
    mutationFn: (m: { id: string; type: string; vmid?: number; storage?: string }) =>
      api.pools.update(pool.poolid, {
        delete: 1,
        ...(m.type === 'storage' ? { storage: m.storage ?? m.id } : { vms: String(m.vmid ?? m.id) }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pool', pool.poolid] });
      qc.invalidateQueries({ queryKey: ['pools'] });
      toast.success('Removed from pool');
    },
    onError: (err) => toast.error('Remove failed', err instanceof Error ? err.message : String(err)),
  });

  const addMember = () => {
    if (!addTarget) return;
    if (selectedType === 'storage') addM.mutate({ storage: addTarget });
    else addM.mutate({ vms: addTarget });
  };

  const Icon = (type: string) => (
    type === 'storage' ? HardDrive : type === 'lxc' ? Box : type === 'node' ? Server : Monitor
  );

  const typeFilteredCandidates = candidates.filter((c) => c.type === selectedType);

  const inputCls = 'px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';

  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white font-mono">{pool.poolid}</h3>
          {pool.comment && <p className="text-xs text-gray-500 mt-0.5">{pool.comment}</p>}
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition flex items-center gap-1.5">
            <Pencil className="w-3 h-3" /> Edit
          </button>
          <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-gray-800 rounded-lg transition">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h4 className="text-xs uppercase text-gray-600 font-medium tracking-wide mb-2">Members ({members.length})</h4>
          {members.length === 0 ? (
            <p className="text-sm text-gray-500">No members yet.</p>
          ) : (
            <div className="bg-gray-950 border border-gray-800 rounded-lg divide-y divide-gray-800">
              {members.map((m) => {
                const IconComp = Icon(m.type);
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <IconComp className="w-4 h-4 text-gray-500 shrink-0" />
                    <span className="font-mono text-sm text-gray-300 flex-1">
                      {m.name ?? m.id}
                      {m.vmid && <span className="text-gray-600 ml-2">({m.vmid})</span>}
                    </span>
                    <Badge variant="outline" className="text-xs">{m.type}</Badge>
                    {m.node && <span className="text-xs text-gray-600 font-mono">{m.node}</span>}
                    <button
                      onClick={() => removeM.mutate(m)}
                      disabled={removeM.isPending}
                      className="p-1 text-red-400 hover:text-red-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition disabled:opacity-40"
                      title="Remove from pool"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-gray-800 pt-4">
          <h4 className="text-xs uppercase text-gray-600 font-medium tracking-wide mb-2">Add member</h4>
          <div className="flex gap-2 flex-wrap">
            <select value={selectedType} onChange={(e) => { setSelectedType(e.target.value as typeof selectedType); setAddTarget(''); }} className={inputCls}>
              <option value="qemu">VM (QEMU)</option>
              <option value="lxc">Container (LXC)</option>
              <option value="storage">Storage</option>
            </select>
            <select value={addTarget} onChange={(e) => setAddTarget(e.target.value)} className={inputCls + ' flex-1 min-w-48'}>
              <option value="">Select a resource…</option>
              {typeFilteredCandidates.map((c) => {
                const val = selectedType === 'storage' ? (c.storage ?? c.id) : String(c.vmid ?? c.id);
                return (
                  <option key={c.id} value={val}>
                    {c.name ?? c.id}
                    {c.vmid && ` (${c.vmid})`}
                    {c.node && ` — ${c.node}`}
                  </option>
                );
              })}
            </select>
            <button
              onClick={addMember}
              disabled={!addTarget || addM.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
            >
              {addM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

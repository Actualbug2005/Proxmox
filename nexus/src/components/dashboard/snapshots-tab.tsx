'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import {
  Camera, Plus, RotateCcw, Trash2, Loader2, ChevronRight, Save, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PVESnapshot, CreateSnapshotParams } from '@/types/proxmox';

type Kind = 'qemu' | 'lxc';

interface SnapshotsTabProps {
  kind: Kind;
  node: string;
  vmid: number;
}

function snapshotApi(kind: Kind) {
  return kind === 'qemu' ? api.vms.snapshot : api.containers.snapshot;
}

function formatTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function CreateSnapshotDialog({
  kind, onSubmit, onCancel, isPending,
}: {
  kind: Kind;
  onSubmit: (params: CreateSnapshotParams) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [snapname, setSnapname] = useState('');
  const [description, setDescription] = useState('');
  const [vmstate, setVmstate] = useState(false);

  const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-sm font-semibold text-white mb-4">Create snapshot</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Name</label>
            <input
              value={snapname}
              onChange={(e) => setSnapname(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              placeholder="pre-upgrade"
              autoFocus
              className={inputCls}
            />
            <p className="text-xs text-gray-600 mt-1">Letters, digits, dash, underscore only.</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={cn(inputCls, 'resize-y')}
            />
          </div>
          {kind === 'qemu' && (
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={vmstate}
                onChange={(e) => setVmstate(e.target.checked)}
                className="rounded border-gray-600"
              />
              Include RAM state (slower, but preserves running state)
            </label>
          )}
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition">
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ snapname, description: description || undefined, vmstate: kind === 'qemu' && vmstate ? 1 : 0 })}
            disabled={!snapname || isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-40"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function EditDescription({
  initial, onSave, onCancel, isPending,
}: {
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="space-y-2">
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="p-1.5 text-gray-500 hover:text-white bg-gray-800 rounded-lg transition"
          aria-label="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onSave(val)}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-40"
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
        </button>
      </div>
    </div>
  );
}

export function SnapshotsTab({ kind, node, vmid }: SnapshotsTabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const client = snapshotApi(kind);

  const [showCreate, setShowCreate] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingDesc, setEditingDesc] = useState<string | null>(null);

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['snapshot', kind, node, vmid],
    queryFn: () => client.list(node, vmid),
    refetchInterval: 15_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['snapshot', kind, node, vmid] });

  const createM = useMutation({
    mutationFn: (params: CreateSnapshotParams) => client.create(node, vmid, params),
    onSuccess: () => {
      setShowCreate(false);
      invalidate();
      toast.success('Snapshot queued', 'Check the Tasks page for progress.');
    },
    onError: (err) => toast.error('Snapshot failed', err instanceof Error ? err.message : String(err)),
  });

  const deleteM = useMutation({
    mutationFn: (snapname: string) => client.delete(node, vmid, snapname),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
      toast.success('Snapshot deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const rollbackM = useMutation({
    mutationFn: (snapname: string) => client.rollback(node, vmid, snapname),
    onSuccess: () => {
      setRollbackTarget(null);
      invalidate();
      toast.success('Rollback queued', 'The guest may restart during rollback.');
    },
    onError: (err) => toast.error('Rollback failed', err instanceof Error ? err.message : String(err)),
  });

  const updateDescM = useMutation({
    mutationFn: (p: { snapname: string; description: string }) =>
      client.updateDescription(node, vmid, p.snapname, p.description),
    onSuccess: () => {
      setEditingDesc(null);
      invalidate();
      toast.success('Description updated');
    },
    onError: (err) => toast.error('Update failed', err instanceof Error ? err.message : String(err)),
  });

  // PVE returns a synthetic "current" entry representing live state — skip it in displays.
  const items = (snapshots ?? []).filter((s) => s.name !== 'current');
  const currentParent = (snapshots ?? []).find((s) => s.name === 'current')?.parent;

  return (
    <>
      {showCreate && (
        <CreateSnapshotDialog
          kind={kind}
          onSubmit={(p) => createM.mutate(p)}
          onCancel={() => setShowCreate(false)}
          isPending={createM.isPending}
        />
      )}

      {rollbackTarget && (
        <ConfirmDialog
          title={`Roll back to "${rollbackTarget}"?`}
          message="Rolling back discards all changes made after this snapshot. The guest may restart during the operation."
          danger
          onConfirm={() => rollbackM.mutate(rollbackTarget)}
          onCancel={() => setRollbackTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete snapshot "${deleteTarget}"?`}
          message="This permanently removes the snapshot. The guest's current state is not affected."
          danger
          onConfirm={() => deleteM.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-300">
              {items.length} snapshot{items.length !== 1 ? 's' : ''}
              {currentParent && items.length > 0 && (
                <span className="text-gray-600"> · currently at <span className="font-mono text-gray-400">{currentParent}</span></span>
              )}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
          >
            <Plus className="w-4 h-4" />
            Create snapshot
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Camera}
            title="No snapshots yet"
            description="Snapshots capture the guest's state at a point in time. You can roll back to any snapshot later."
          />
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Parent</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Created</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Description</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s: PVESnapshot) => {
                  const isCurrent = currentParent === s.name;
                  return (
                    <tr key={s.name} className="border-b border-gray-800/40 hover:bg-gray-800/20 align-top">
                      <td className="px-4 py-3 font-mono text-gray-200">
                        <div className="flex items-center gap-2">
                          {isCurrent && <ChevronRight className="w-3.5 h-3.5 text-orange-400" />}
                          {s.name}
                          {s.vmstate ? (
                            <span className="text-xs text-blue-400 ml-1">(with RAM)</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.parent ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatTime(s.snaptime)}</td>
                      <td className="px-4 py-3 text-gray-400 max-w-[20rem]">
                        {editingDesc === s.name ? (
                          <EditDescription
                            initial={s.description ?? ''}
                            onSave={(val) => updateDescM.mutate({ snapname: s.name, description: val })}
                            onCancel={() => setEditingDesc(null)}
                            isPending={updateDescM.isPending}
                          />
                        ) : (
                          <button
                            onClick={() => setEditingDesc(s.name)}
                            className="text-left w-full hover:text-gray-200 transition"
                          >
                            {s.description || <span className="text-gray-600 italic">click to add…</span>}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => setRollbackTarget(s.name)}
                            disabled={rollbackM.isPending}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-blue-400 hover:text-blue-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition disabled:opacity-40"
                            title="Roll back to this snapshot"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Rollback
                          </button>
                          <button
                            onClick={() => setDeleteTarget(s.name)}
                            disabled={deleteM.isPending}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-red-400 hover:text-red-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition disabled:opacity-40"
                            title="Delete snapshot"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

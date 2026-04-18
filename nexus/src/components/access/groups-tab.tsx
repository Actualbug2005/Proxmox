'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { api } from '@/lib/proxmox-client';
import { Plus, Pencil, Trash2, Users as UsersIcon, Loader2, Save, X } from 'lucide-react';
import type { PVEGroup, GroupParams } from '@/types/proxmox';

export function GroupsTab() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: groups, isLoading } = useQuery({ queryKey: ['access', 'groups'], queryFn: () => api.access.groups.list() });

  const [edit, setEdit] = useState<PVEGroup | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PVEGroup | null>(null);

  const deleteM = useMutation({
    mutationFn: (g: PVEGroup) => api.access.groups.delete(g.groupid),
    onSuccess: () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['access', 'groups'] }); toast.success('Group deleted'); },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  return (
    <>
      {deleteTarget && (
        <ConfirmDialog title={`Delete group "${deleteTarget.groupid}"?`} message="Members keep their individual memberships; only the group and its ACL entries are removed." danger onConfirm={() => deleteM.mutate(deleteTarget)} onCancel={() => setDeleteTarget(null)} />
      )}
      {(edit || showNew) && (
        <GroupEditor initial={edit} onClose={() => { setEdit(null); setShowNew(false); }} onSaved={() => { setEdit(null); setShowNew(false); qc.invalidateQueries({ queryKey: ['access', 'groups'] }); }} />
      )}

      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition">
            <Plus className="w-4 h-4" /> New group
          </button>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" /></div>
        ) : !groups || groups.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No groups" description="Groups let you assign ACL entries to multiple users at once." />
        ) : (
          <div className="studio-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Group</th>
                  <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Users</th>
                  <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Comment</th>
                  <th className="text-right px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.groupid} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                    <td className="px-4 py-3 font-mono text-[var(--color-fg-secondary)]">{g.groupid}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-mono">{g.users ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-fg-muted)]">{g.comment ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-0.5 justify-end">
                        <button onClick={() => setEdit(g)} className="p-1 text-[var(--color-fg-secondary)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => setDeleteTarget(g)} className="p-1 text-red-400 hover:text-red-300 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"><Trash2 className="w-3 h-3" /></button>
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

function GroupEditor({ initial, onClose, onSaved }: { initial: PVEGroup | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!initial;
  const [groupid, setGroupid] = useState(initial?.groupid ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');

  const saveM = useMutation({
    mutationFn: (params: GroupParams) => isEdit && initial ? api.access.groups.update(initial.groupid, params) : api.access.groups.create(params),
    onSuccess: () => { toast.success(isEdit ? 'Group updated' : 'Group created'); onSaved(); },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const inputCls = 'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit group' : 'New group'}</h3>
          <button onClick={onClose} className="text-[var(--color-fg-subtle)] hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Group ID</label>
            <input value={groupid} onChange={(e) => setGroupid(e.target.value)} disabled={isEdit} className={inputCls + (isEdit ? ' opacity-60' : '')} />
          </div>
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition">Cancel</button>
          <button onClick={() => saveM.mutate({ groupid, ...(comment ? { comment } : {}) })} disabled={!groupid || saveM.isPending} className="flex items-center gap-2 px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition disabled:opacity-40">
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

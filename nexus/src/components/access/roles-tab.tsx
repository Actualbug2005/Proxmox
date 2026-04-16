'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/proxmox-client';
import { Plus, Pencil, Trash2, ShieldCheck, Loader2, Save, X } from 'lucide-react';
import type { PVERolePublic, RoleParams } from '@/types/proxmox';

export function RolesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: roles, isLoading } = useQuery({ queryKey: ['access', 'roles'], queryFn: () => api.access.roles.list() });

  const [edit, setEdit] = useState<PVERolePublic | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PVERolePublic | null>(null);

  const deleteM = useMutation({
    mutationFn: (r: PVERolePublic) => api.access.roles.delete(r.roleid),
    onSuccess: () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['access', 'roles'] }); toast.success('Role deleted'); },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  return (
    <>
      {deleteTarget && (
        <ConfirmDialog title={`Delete role "${deleteTarget.roleid}"?`} message="ACL entries referencing this role will break. Reassign them first." danger onConfirm={() => deleteM.mutate(deleteTarget)} onCancel={() => setDeleteTarget(null)} />
      )}
      {(edit || showNew) && (
        <RoleEditor initial={edit} onClose={() => { setEdit(null); setShowNew(false); }} onSaved={() => { setEdit(null); setShowNew(false); qc.invalidateQueries({ queryKey: ['access', 'roles'] }); }} />
      )}

      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 hover:bg-white text-white text-sm rounded-lg transition">
            <Plus className="w-4 h-4" /> New role
          </button>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : !roles || roles.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No roles" />
        ) : (
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800/60">
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Role</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Privileges</th>
                  <th className="text-right px-4 py-3 text-xs text-zinc-500 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.roleid} className="border-b border-zinc-800/60/40 hover:bg-zinc-800/20">
                    <td className="px-4 py-3 font-mono text-zinc-200">{r.roleid}</td>
                    <td className="px-4 py-3">
                      {(r.special ?? false) ? <Badge variant="outline" className="text-xs">built-in</Badge> : <Badge variant="success" className="text-xs">custom</Badge>}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400 font-mono break-words max-w-2xl">{r.privs ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-0.5 justify-end">
                        <button onClick={() => setEdit(r)} disabled={(r.special ?? false)} className="p-1 text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-800 rounded-lg transition disabled:opacity-30" title={(r.special ?? false) ? 'Built-in — read only' : 'Edit'}><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => setDeleteTarget(r)} disabled={(r.special ?? false)} className="p-1 text-red-400 hover:text-red-300 bg-zinc-800 hover:bg-zinc-800 rounded-lg transition disabled:opacity-30" title={(r.special ?? false) ? 'Built-in — read only' : 'Delete'}><Trash2 className="w-3 h-3" /></button>
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

function RoleEditor({ initial, onClose, onSaved }: { initial: PVERolePublic | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!initial;
  const [roleid, setRoleid] = useState(initial?.roleid ?? '');
  const [privs, setPrivs] = useState(initial?.privs ?? '');

  const saveM = useMutation({
    mutationFn: (params: RoleParams) => isEdit && initial ? api.access.roles.update(initial.roleid, params) : api.access.roles.create(params),
    onSuccess: () => { toast.success(isEdit ? 'Role updated' : 'Role created'); onSaved(); },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit role' : 'New role'}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Role ID</label>
            <input value={roleid} onChange={(e) => setRoleid(e.target.value)} disabled={isEdit} className={inputCls + (isEdit ? ' opacity-60' : '')} />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Privileges (comma-separated)</label>
            <textarea value={privs} onChange={(e) => setPrivs(e.target.value)} rows={5} placeholder="VM.PowerMgmt,VM.Console,VM.Audit" className={inputCls + ' font-mono resize-y'} />
            <p className="text-xs text-zinc-600 mt-1">Common: VM.Audit, VM.PowerMgmt, VM.Console, VM.Monitor, Sys.Audit, Datastore.Audit</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition">Cancel</button>
          <button onClick={() => saveM.mutate({ roleid, ...(privs ? { privs } : {}) })} disabled={!roleid || saveM.isPending} className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-white text-sm rounded-lg transition disabled:opacity-40">
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

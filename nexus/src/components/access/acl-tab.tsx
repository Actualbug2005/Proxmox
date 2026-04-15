'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/proxmox-client';
import { Plus, Trash2, Key, Loader2, Save, X } from 'lucide-react';
import type { PVEACLPublic, PVEUserPublic, PVEGroup, PVERole } from '@/types/proxmox';

export function ACLTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: acls, isLoading } = useQuery({ queryKey: ['access', 'acl'], queryFn: () => api.access.acl.list() });
  const { data: users } = useQuery({ queryKey: ['access', 'users'], queryFn: () => api.access.users.list() });
  const { data: groups } = useQuery({ queryKey: ['access', 'groups'], queryFn: () => api.access.groups.list() });
  const { data: roles } = useQuery({ queryKey: ['access', 'roles'], queryFn: () => api.access.roles.list() });

  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PVEACLPublic | null>(null);

  const deleteM = useMutation({
    mutationFn: (a: PVEACLPublic) =>
      api.access.acl.update({
        path: a.path,
        roles: a.roleid,
        delete: true,
        ...(a.type === 'user' ? { users: a.ugid } : a.type === 'group' ? { groups: a.ugid } : { tokens: a.ugid }),
      }),
    onSuccess: () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['access', 'acl'] }); toast.success('ACL entry removed'); },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  return (
    <>
      {deleteTarget && (
        <ConfirmDialog title="Remove ACL entry?" message={`Revokes ${deleteTarget.roleid} for ${deleteTarget.ugid} on ${deleteTarget.path}.`} danger onConfirm={() => deleteM.mutate(deleteTarget)} onCancel={() => setDeleteTarget(null)} />
      )}

      {showNew && (
        <ACLEditor
          users={users ?? []}
          groups={groups ?? []}
          roles={roles ?? []}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['access', 'acl'] }); }}
        />
      )}

      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition">
            <Plus className="w-4 h-4" /> New entry
          </button>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
        ) : !acls || acls.length === 0 ? (
          <EmptyState icon={Key} title="No ACL entries" description="Grant a user or group a role on a specific path (e.g. /vms/101 or /storage/mystore)." />
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Path</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Who</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Role</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Propagate</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {acls.map((a, i) => (
                  <tr key={`${a.path}-${a.ugid}-${a.roleid}-${i}`} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="px-4 py-2 font-mono text-xs text-gray-200">{a.path}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">
                      <Badge variant="outline" className="text-xs mr-1">{a.type}</Badge>
                      <span className="font-mono">{a.ugid}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">{a.roleid}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{(a.propagate ?? false) ? 'yes' : 'no'}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setDeleteTarget(a)} className="p-1 text-red-400 hover:text-red-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"><Trash2 className="w-3 h-3" /></button>
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

function ACLEditor({ users, groups, roles, onClose, onSaved }: {
  users: PVEUserPublic[]; groups: PVEGroup[]; roles: PVERole[];
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [path, setPath] = useState('/');
  const [who, setWho] = useState<'user' | 'group'>('user');
  const [userid, setUserid] = useState('');
  const [groupid, setGroupid] = useState('');
  const [roleid, setRoleid] = useState('');
  const [propagate, setPropagate] = useState(true);

  const saveM = useMutation({
    mutationFn: () =>
      api.access.acl.update({
        path,
        roles: roleid,
        propagate,
        ...(who === 'user' ? { users: userid } : { groups: groupid }),
      }),
    onSuccess: () => { toast.success('ACL entry created'); onSaved(); },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">New ACL entry</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Path</label>
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/vms/101 or /storage/mystore or /" className={inputCls + ' font-mono'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Subject</label>
            <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit mb-2">
              <button onClick={() => setWho('user')} className={who === 'user' ? 'px-3 py-1 text-xs bg-gray-700 text-white rounded-md' : 'px-3 py-1 text-xs text-gray-500 hover:text-gray-300 rounded-md'}>User</button>
              <button onClick={() => setWho('group')} className={who === 'group' ? 'px-3 py-1 text-xs bg-gray-700 text-white rounded-md' : 'px-3 py-1 text-xs text-gray-500 hover:text-gray-300 rounded-md'}>Group</button>
            </div>
            {who === 'user' ? (
              <select value={userid} onChange={(e) => setUserid(e.target.value)} className={inputCls}>
                <option value="">Select a user…</option>
                {users.map((u) => <option key={u.userid} value={u.userid}>{u.userid}</option>)}
              </select>
            ) : (
              <select value={groupid} onChange={(e) => setGroupid(e.target.value)} className={inputCls}>
                <option value="">Select a group…</option>
                {groups.map((g) => <option key={g.groupid} value={g.groupid}>{g.groupid}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Role</label>
            <select value={roleid} onChange={(e) => setRoleid(e.target.value)} className={inputCls}>
              <option value="">Select a role…</option>
              {roles.map((r) => <option key={r.roleid} value={r.roleid}>{r.roleid}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={propagate} onChange={(e) => setPropagate(e.target.checked)} className="rounded border-gray-600" />
            Propagate to child paths
          </label>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition">Cancel</button>
          <button onClick={() => saveM.mutate()} disabled={!path || !roleid || (who === 'user' ? !userid : !groupid) || saveM.isPending} className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40">
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

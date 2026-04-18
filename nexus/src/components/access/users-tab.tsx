'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/proxmox-client';
import { Plus, Pencil, Trash2, KeyRound, Users as UsersIcon, Loader2, Save, X } from 'lucide-react';
import type { PVEUserPublic, UserParamsPublic, PVERealmPublic, PVEGroup } from '@/types/proxmox';

export function UsersTab() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: users, isLoading } = useQuery({ queryKey: ['access', 'users'], queryFn: () => api.access.users.list() });
  const { data: realms } = useQuery({ queryKey: ['access', 'realms'], queryFn: () => api.access.realms.list() });
  const { data: groups } = useQuery({ queryKey: ['access', 'groups'], queryFn: () => api.access.groups.list() });

  const [edit, setEdit] = useState<PVEUserPublic | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PVEUserPublic | null>(null);
  const [pwTarget, setPwTarget] = useState<PVEUserPublic | null>(null);

  const deleteM = useMutation({
    mutationFn: (u: PVEUserPublic) => api.access.users.delete(u.userid),
    onSuccess: () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['access', 'users'] }); toast.success('User deleted'); },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  return (
    <>
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete user "${deleteTarget.userid}"?`}
          message="The user's ACL entries are also removed. This cannot be undone."
          danger
          onConfirm={() => deleteM.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {pwTarget && <PasswordDialog user={pwTarget} onClose={() => setPwTarget(null)} />}

      {(edit || showNew) && (
        <UserEditor
          initial={edit}
          realms={realms ?? []}
          groups={groups ?? []}
          onClose={() => { setEdit(null); setShowNew(false); }}
          onSaved={() => { setEdit(null); setShowNew(false); qc.invalidateQueries({ queryKey: ['access', 'users'] }); }}
        />
      )}

      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition">
            <Plus className="w-4 h-4" /> New user
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" /></div>
        ) : !users || users.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No users" description="Create a non-root user and assign ACL entries to delegate access." />
        ) : (
          <div className="studio-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">User</th>
                  <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Email</th>
                  <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Groups</th>
                  <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userid} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                    <td className="px-4 py-3 font-mono text-[var(--color-fg-secondary)]">{u.userid}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-fg-muted)]">{u.email ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-mono">{u.groups ?? '—'}</td>
                    <td className="px-4 py-3">
                      {u.enable === false ? <Badge variant="danger" className="text-xs">disabled</Badge> : <Badge variant="success" className="text-xs">enabled</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-0.5 justify-end">
                        <button onClick={() => setPwTarget(u)} disabled={!u.userid.endsWith('@pve') && !u.userid.endsWith('@pam')} className="p-1 text-[var(--color-fg-secondary)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-30" title="Change password (PVE/PAM realms only)"><KeyRound className="w-3 h-3" /></button>
                        <button onClick={() => setEdit(u)} className="p-1 text-[var(--color-fg-secondary)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => setDeleteTarget(u)} disabled={u.userid === 'root@pam'} className="p-1 text-red-400 hover:text-red-300 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-30" title={u.userid === 'root@pam' ? "Can't delete root" : 'Delete'}><Trash2 className="w-3 h-3" /></button>
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

function UserEditor({ initial, realms, groups, onClose, onSaved }: {
  initial: PVEUserPublic | null;
  realms: PVERealmPublic[];
  groups: PVEGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!initial;

  // parse userid = name@realm
  const [name, realm] = initial?.userid?.split('@') ?? ['', realms[0]?.realm ?? 'pve'];
  const [userName, setUserName] = useState(name ?? '');
  const [userRealm, setUserRealm] = useState(realm ?? 'pve');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [firstname, setFirstname] = useState(initial?.firstname ?? '');
  const [lastname, setLastname] = useState(initial?.lastname ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [enable, setEnable] = useState(initial?.enable !== false);
  const [userGroups, setUserGroups] = useState(initial?.groups ?? '');

  const saveM = useMutation({
    mutationFn: (params: UserParamsPublic) => isEdit && initial ? api.access.users.update(initial.userid, params) : api.access.users.create(params),
    onSuccess: () => { toast.success(isEdit ? 'User updated' : 'User created'); onSaved(); },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    const userid = `${userName}@${userRealm}`;
    const params: UserParamsPublic = {
      userid,
      enable,
      ...(email ? { email } : {}),
      ...(firstname ? { firstname } : {}),
      ...(lastname ? { lastname } : {}),
      ...(comment ? { comment } : {}),
      ...(userGroups ? { groups: userGroups } : {}),
      ...(!isEdit && password ? { password } : {}),
    };
    saveM.mutate(params);
  };

  const inputCls = 'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit user' : 'New user'}</h3>
          <button onClick={onClose} className="text-[var(--color-fg-subtle)] hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Username</label>
              <input value={userName} onChange={(e) => setUserName(e.target.value)} disabled={isEdit} placeholder="alice" className={inputCls + (isEdit ? ' opacity-60' : '')} />
            </div>
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Realm</label>
              <select value={userRealm} onChange={(e) => setUserRealm(e.target.value)} disabled={isEdit} className={inputCls + (isEdit ? ' opacity-60' : '')}>
                {realms.map((r) => <option key={r.realm} value={r.realm}>{r.realm}</option>)}
              </select>
            </div>
          </div>

          {!isEdit && (userRealm === 'pve' || userRealm === 'pam') && (
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">First name</label>
              <input value={firstname} onChange={(e) => setFirstname(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Last name</label>
              <input value={lastname} onChange={(e) => setLastname(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Groups (comma-separated)</label>
            <input value={userGroups} onChange={(e) => setUserGroups(e.target.value)} placeholder="admins,auditors" className={inputCls} />
            {groups.length > 0 && <p className="text-xs text-[var(--color-fg-faint)] mt-1 font-mono">available: {groups.map((g) => g.groupid).join(', ')}</p>}
          </div>

          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--color-fg-secondary)] cursor-pointer">
            <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} className="rounded border-gray-600" />
            Enabled
          </label>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition">Cancel</button>
          <button onClick={submit} disabled={!userName || saveM.isPending} className="flex items-center gap-2 px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition disabled:opacity-40">
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordDialog({ user, onClose }: { user: PVEUserPublic; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const M = useMutation({
    mutationFn: () => api.access.users.resetPassword(user.userid, password),
    onSuccess: () => { toast.success('Password changed', user.userid); onClose(); },
    onError: (err) => toast.error('Change failed', err instanceof Error ? err.message : String(err)),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-sm font-semibold text-white mb-4">Change password for {user.userid}</h3>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus placeholder="New password" className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50 mb-4" />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} disabled={M.isPending} className="px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40">Cancel</button>
          <button onClick={() => M.mutate()} disabled={!password || M.isPending} className="flex items-center gap-2 px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition disabled:opacity-40">
            {M.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Change
          </button>
        </div>
      </div>
    </div>
  );
}

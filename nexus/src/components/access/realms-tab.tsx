'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/proxmox-client';
import { Plus, Pencil, Trash2, Globe, Loader2, Save, X, RefreshCw } from 'lucide-react';
import type { PVERealmPublic, RealmParamsPublic, RealmType } from '@/types/proxmox';

export function RealmsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: realms, isLoading } = useQuery({ queryKey: ['access', 'realms'], queryFn: () => api.access.realms.list() });

  const [edit, setEdit] = useState<PVERealmPublic | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PVERealmPublic | null>(null);

  const deleteM = useMutation({
    mutationFn: (r: PVERealmPublic) => api.access.realms.delete(r.realm),
    onSuccess: () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['access', 'realms'] }); toast.success('Realm deleted'); },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const syncM = useMutation({
    mutationFn: (r: PVERealmPublic) => api.access.realms.sync(r.realm),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['access', 'users'] }); toast.success(`Sync queued for ${vars.realm}`); },
    onError: (err) => toast.error('Sync failed', err instanceof Error ? err.message : String(err)),
  });

  const canSync = (r: PVERealmPublic) => r.type === 'ldap' || r.type === 'ad';
  const canDelete = (r: PVERealmPublic) => r.type !== 'pam' && r.realm !== 'pve';

  return (
    <>
      {deleteTarget && (
        <ConfirmDialog title={`Delete realm "${deleteTarget.realm}"?`} message="Users authenticating against this realm will lose access." danger onConfirm={() => deleteM.mutate(deleteTarget)} onCancel={() => setDeleteTarget(null)} />
      )}
      {(edit || showNew) && (
        <RealmEditor initial={edit} onClose={() => { setEdit(null); setShowNew(false); }} onSaved={() => { setEdit(null); setShowNew(false); qc.invalidateQueries({ queryKey: ['access', 'realms'] }); }} />
      )}

      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 hover:bg-white text-white text-sm rounded-lg transition">
            <Plus className="w-4 h-4" /> New realm
          </button>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : !realms || realms.length === 0 ? (
          <EmptyState icon={Globe} title="No realms" />
        ) : (
          <div className="studio-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800/60">
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Realm</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Default</th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Comment</th>
                  <th className="text-right px-4 py-3 text-xs text-zinc-500 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {realms.map((r) => (
                  <tr key={r.realm} className="border-b border-zinc-800/60/40 hover:bg-zinc-800/20">
                    <td className="px-4 py-3 font-mono text-zinc-200">{r.realm}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{r.type}</Badge></td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{(r.default ?? false) ? 'yes' : ''}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{r.comment ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-0.5 justify-end">
                        {canSync(r) && (
                          <button onClick={() => syncM.mutate(r)} disabled={syncM.isPending} className="p-1 text-blue-400 hover:text-blue-300 bg-zinc-800 hover:bg-zinc-800 rounded-lg transition" title="Sync users"><RefreshCw className="w-3 h-3" /></button>
                        )}
                        <button onClick={() => setEdit(r)} className="p-1 text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-800 rounded-lg transition"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => setDeleteTarget(r)} disabled={!canDelete(r)} className="p-1 text-red-400 hover:text-red-300 bg-zinc-800 hover:bg-zinc-800 rounded-lg transition disabled:opacity-30" title={!canDelete(r) ? 'Cannot delete built-in realm' : 'Delete'}><Trash2 className="w-3 h-3" /></button>
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

function RealmEditor({ initial, onClose, onSaved }: { initial: PVERealmPublic | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!initial;
  const [realm, setRealm] = useState(initial?.realm ?? '');
  const [type, setType] = useState<RealmType>(initial?.type ?? 'ldap');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [isDefault, setIsDefault] = useState(initial?.default ?? false);
  // LDAP/AD fields
  const [server1, setServer1] = useState(initial?.server1 ?? '');
  const [server2, setServer2] = useState(initial?.server2 ?? '');
  const [baseDn, setBaseDn] = useState(initial?.base_dn ?? '');
  const [userAttr, setUserAttr] = useState(initial?.user_attr ?? '');
  const [bindDn, setBindDn] = useState(initial?.bind_dn ?? '');
  const [port, setPort] = useState(String(initial?.port ?? ''));
  const [secure, setSecure] = useState(initial?.secure ?? false);
  // OpenID
  const [issuer, setIssuer] = useState(initial?.['issuer-url'] ?? '');
  const [clientId, setClientId] = useState(initial?.['client-id'] ?? '');
  const [clientKey, setClientKey] = useState(initial?.['client-key'] ?? '');
  const [autocreate, setAutocreate] = useState(initial?.autocreate ?? false);

  const saveM = useMutation({
    mutationFn: (params: RealmParamsPublic) => isEdit && initial ? api.access.realms.update(initial.realm, params) : api.access.realms.create(params),
    onSuccess: () => { toast.success(isEdit ? 'Realm updated' : 'Realm created'); onSaved(); },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    const base: RealmParamsPublic = { realm, type, comment, default: isDefault };
    if (type === 'ldap' || type === 'ad') {
      Object.assign(base, {
        server1, ...(server2 ? { server2 } : {}),
        base_dn: baseDn, user_attr: userAttr,
        ...(bindDn ? { bind_dn: bindDn } : {}),
        ...(port ? { port: Number(port) } : {}),
        secure,
      });
    }
    if (type === 'openid') {
      Object.assign(base, {
        'issuer-url': issuer,
        'client-id': clientId,
        ...(clientKey ? { 'client-key': clientKey } : {}),
        autocreate,
      });
    }
    saveM.mutate(base);
  };

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <div className="studio-card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit realm' : 'New realm'}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Realm ID</label>
              <input value={realm} onChange={(e) => setRealm(e.target.value)} disabled={isEdit} className={inputCls + (isEdit ? ' opacity-60' : '')} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as RealmType)} disabled={isEdit} className={inputCls + (isEdit ? ' opacity-60' : '')}>
                <option value="ldap">LDAP</option>
                <option value="ad">Active Directory</option>
                <option value="openid">OpenID Connect</option>
                <option value="pve">PVE</option>
                <option value="pam">PAM</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded border-gray-600" />
            Default realm on login
          </label>

          {(type === 'ldap' || type === 'ad') && (
            <>
              <div className="pt-2 border-t border-zinc-800/60" />
              <h4 className="text-xs uppercase text-zinc-600 font-medium tracking-widest">Directory</h4>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-zinc-500 block mb-1">Server 1</label><input value={server1} onChange={(e) => setServer1(e.target.value)} className={inputCls} /></div>
                <div><label className="text-xs text-zinc-500 block mb-1">Server 2 (optional)</label><input value={server2} onChange={(e) => setServer2(e.target.value)} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <div><label className="text-xs text-zinc-500 block mb-1">Base DN</label><input value={baseDn} onChange={(e) => setBaseDn(e.target.value)} placeholder="DC=example,DC=com" className={inputCls + ' font-mono'} /></div>
                <div><label className="text-xs text-zinc-500 block mb-1">Port</label><input type="number" value={port} onChange={(e) => setPort(e.target.value)} className={inputCls} /></div>
              </div>
              <div><label className="text-xs text-zinc-500 block mb-1">User attribute</label><input value={userAttr} onChange={(e) => setUserAttr(e.target.value)} placeholder={type === 'ad' ? 'sAMAccountName' : 'uid'} className={inputCls} /></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Bind DN (optional)</label><input value={bindDn} onChange={(e) => setBindDn(e.target.value)} placeholder="CN=nexus,OU=Service Accounts,DC=example,DC=com" className={inputCls + ' font-mono text-xs'} /></div>
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} className="rounded border-gray-600" />
                TLS (LDAPS)
              </label>
            </>
          )}

          {type === 'openid' && (
            <>
              <div className="pt-2 border-t border-zinc-800/60" />
              <h4 className="text-xs uppercase text-zinc-600 font-medium tracking-widest">OpenID Connect</h4>
              <div><label className="text-xs text-zinc-500 block mb-1">Issuer URL</label><input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://id.example.com" className={inputCls} /></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Client ID</label><input value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls} /></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Client secret</label><input value={clientKey} onChange={(e) => setClientKey(e.target.value)} className={inputCls} /></div>
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={autocreate} onChange={(e) => setAutocreate(e.target.checked)} className="rounded border-gray-600" />
                Auto-create users on first login
              </label>
            </>
          )}
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition">Cancel</button>
          <button onClick={submit} disabled={!realm || saveM.isPending} className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-white text-white text-sm rounded-lg transition disabled:opacity-40">
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

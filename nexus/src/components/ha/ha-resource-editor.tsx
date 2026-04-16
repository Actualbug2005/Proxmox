'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { Loader2, Save, X } from 'lucide-react';
import type { HAResource, HAResourceParams, HAState } from '@/types/proxmox';

interface HAResourceEditorProps {
  initial?: HAResource | null;
  onClose: () => void;
  onSaved: () => void;
}

export function HAResourceEditor({ initial, onClose, onSaved }: HAResourceEditorProps) {
  const toast = useToast();
  const isEdit = !!initial;

  const { data: resources } = useQuery({ queryKey: ['cluster', 'resources'], queryFn: () => api.cluster.resources() });
  const candidates = (resources ?? []).filter((r) => r.type === 'qemu' || r.type === 'lxc');

  const { data: groups } = useQuery({ queryKey: ['ha', 'groups'], queryFn: () => api.ha.groups.list() });

  const [sid, setSid] = useState(initial?.sid ?? '');
  const [state, setState] = useState<HAState>(initial?.state ?? 'started');
  const [group, setGroup] = useState(initial?.group ?? '');
  const [maxRestart, setMaxRestart] = useState(String(initial?.max_restart ?? 1));
  const [maxRelocate, setMaxRelocate] = useState(String(initial?.max_relocate ?? 1));
  const [comment, setComment] = useState(initial?.comment ?? '');

  const saveM = useMutation({
    mutationFn: (params: HAResourceParams) =>
      isEdit && initial ? api.ha.resources.update(initial.sid, params) : api.ha.resources.create(params),
    onSuccess: () => {
      toast.success(isEdit ? 'HA resource updated' : 'HA resource added');
      onSaved();
    },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    saveM.mutate({
      sid,
      state,
      ...(group ? { group } : {}),
      max_restart: Number(maxRestart) || 0,
      max_relocate: Number(maxRelocate) || 0,
      ...(comment ? { comment } : {}),
    });
  };

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit HA resource' : 'Add HA resource'}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Resource (SID)</label>
            {isEdit ? (
              <input value={sid} disabled className={inputCls + ' opacity-60'} />
            ) : (
              <select value={sid} onChange={(e) => setSid(e.target.value)} className={inputCls}>
                <option value="">Select a VM or CT…</option>
                {candidates.map((r) => {
                  const prefix = r.type === 'qemu' ? 'vm' : 'ct';
                  const val = `${prefix}:${r.vmid}`;
                  return (
                    <option key={val} value={val}>
                      {val} — {r.name ?? r.vmid} ({r.node})
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Desired state</label>
            <select value={state} onChange={(e) => setState(e.target.value as HAState)} className={inputCls}>
              <option value="started">started — keep running (restart on failure)</option>
              <option value="stopped">stopped — shut down and keep off</option>
              <option value="enabled">enabled — manage but don&apos;t enforce state</option>
              <option value="disabled">disabled — ignore (don&apos;t act on failures)</option>
              <option value="ignored">ignored — same as disabled</option>
            </select>
            <p className="text-xs text-zinc-600 mt-1">
              &quot;started&quot; keeps the guest running even across node failures. &quot;stopped&quot; actively powers it down.
            </p>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Group (optional)</label>
            <select value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls}>
              <option value="">(none)</option>
              {(groups ?? []).map((g) => (
                <option key={g.group} value={g.group}>{g.group} — nodes: {g.nodes}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Max restart</label>
              <input type="number" min={0} value={maxRestart} onChange={(e) => setMaxRestart(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Max relocate</label>
              <input type="number" min={0} value={maxRelocate} onChange={(e) => setMaxRelocate(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={saveM.isPending} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40">Cancel</button>
          <button
            onClick={submit}
            disabled={!sid || saveM.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-40"
          >
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { Loader2, Save, X } from 'lucide-react';
import type { HAGroupPublic, HAGroupParamsPublic } from '@/types/proxmox';

interface HAGroupEditorProps {
  initial?: HAGroupPublic | null;
  onClose: () => void;
  onSaved: () => void;
}

export function HAGroupEditor({ initial, onClose, onSaved }: HAGroupEditorProps) {
  const toast = useToast();
  const isEdit = !!initial;

  const { data: status } = useQuery({ queryKey: ['cluster', 'status'], queryFn: () => api.cluster.status() });
  const availableNodes = (status ?? []).filter((s) => s.type === 'node');

  const [groupName, setGroupName] = useState(initial?.group ?? '');
  const [nodePriorities, setNodePriorities] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    if (initial?.nodes) {
      initial.nodes.split(',').forEach((entry) => {
        const [name, prio] = entry.split(':');
        out[name] = prio ? Number(prio) : 1;
      });
    }
    return out;
  });
  const [restricted, setRestricted] = useState(initial?.restricted ?? false);
  const [nofailback, setNofailback] = useState(initial?.nofailback ?? false);
  const [comment, setComment] = useState(initial?.comment ?? '');

  const saveM = useMutation({
    mutationFn: (params: HAGroupParamsPublic) =>
      isEdit && initial ? api.ha.groups.update(initial.group, params) : api.ha.groups.create(params),
    onSuccess: () => {
      toast.success(isEdit ? 'Group updated' : 'Group created');
      onSaved();
    },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const toggleNode = (name: string) => {
    setNodePriorities((prev) => {
      const next = { ...prev };
      if (name in next) delete next[name];
      else next[name] = 1;
      return next;
    });
  };

  const setPriority = (name: string, prio: number) => {
    setNodePriorities((prev) => ({ ...prev, [name]: prio }));
  };

  const submit = () => {
    const nodesStr = Object.entries(nodePriorities).map(([n, p]) => `${n}:${p}`).join(',');
    saveM.mutate({
      group: groupName,
      nodes: nodesStr,
      restricted,
      nofailback,
      ...(comment ? { comment } : {}),
    });
  };

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? 'Edit HA group' : 'New HA group'}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Group name</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              disabled={isEdit}
              placeholder="primary-nodes"
              className={inputCls + (isEdit ? ' opacity-60' : '')}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-2">Member nodes (priority 0 = lowest)</label>
            <div className="space-y-2">
              {availableNodes.map((n) => {
                const active = n.name in nodePriorities;
                return (
                  <div key={n.name} className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleNode(n.name)}
                        className="rounded border-gray-600"
                      />
                      <span className="font-mono">{n.name}</span>
                    </label>
                    {active && (
                      <input
                        type="number"
                        min={0}
                        value={nodePriorities[n.name]}
                        onChange={(e) => setPriority(n.name, Number(e.target.value) || 0)}
                        className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} className="rounded border-gray-600" />
            Restricted — only run on listed nodes (never failover elsewhere)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={nofailback} onChange={(e) => setNofailback(e.target.checked)} className="rounded border-gray-600" />
            No failback — don&apos;t return to higher-priority node once failed-over
          </label>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={saveM.isPending} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40">Cancel</button>
          <button
            onClick={submit}
            disabled={!groupName || Object.keys(nodePriorities).length === 0 || saveM.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-40"
          >
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

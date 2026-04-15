'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { Loader2, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createRule, updateRule, type FirewallScope } from './firewall-scope';
import type { FirewallRulePublic, FirewallRuleParamsPublic, FirewallRuleType } from '@/types/proxmox';

interface RuleEditorProps {
  scope: FirewallScope;
  initial?: FirewallRulePublic | null;
  onClose: () => void;
  onSaved: () => void;
}

const ACTIONS = ['ACCEPT', 'DROP', 'REJECT'];

export function RuleEditor({ scope, initial, onClose, onSaved }: RuleEditorProps) {
  const toast = useToast();
  const isEdit = !!initial;

  const [type, setType] = useState<FirewallRuleType>(initial?.type ?? 'in');
  const [action, setAction] = useState(initial?.action ?? 'ACCEPT');
  const [enable, setEnable] = useState(initial?.enable !== false);
  const [macro, setMacro] = useState(initial?.macro ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [dest, setDest] = useState(initial?.dest ?? '');
  const [proto, setProto] = useState(initial?.proto ?? '');
  const [sport, setSport] = useState(initial?.sport ?? '');
  const [dport, setDport] = useState(initial?.dport ?? '');
  const [iface, setIface] = useState(initial?.iface ?? '');
  const [log, setLog] = useState(initial?.log ?? 'nolog');
  const [comment, setComment] = useState(initial?.comment ?? '');

  const saveM = useMutation({
    mutationFn: (params: FirewallRuleParamsPublic) =>
      isEdit && initial ? updateRule(scope, initial.pos, params) : createRule(scope, params),
    onSuccess: () => {
      toast.success(isEdit ? 'Rule updated' : 'Rule created');
      onSaved();
    },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    const params: FirewallRuleParamsPublic = {
      type, action,
      enable,
      ...(macro ? { macro } : {}),
      ...(source ? { source } : {}),
      ...(dest ? { dest } : {}),
      ...(proto ? { proto } : {}),
      ...(sport ? { sport } : {}),
      ...(dport ? { dport } : {}),
      ...(iface ? { iface } : {}),
      log,
      ...(comment ? { comment } : {}),
      ...(initial?.digest ? { digest: initial.digest } : {}),
    };
    saveM.mutate(params);
  };

  const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{isEdit ? `Edit rule #${initial.pos}` : 'New firewall rule'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Direction</label>
              <select value={type} onChange={(e) => setType(e.target.value as FirewallRuleType)} className={inputCls}>
                <option value="in">inbound</option>
                <option value="out">outbound</option>
                <option value="group">security group ref</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Action</label>
              <select value={action} onChange={(e) => setAction(e.target.value)} className={inputCls}>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Macro (optional)</label>
            <input value={macro} onChange={(e) => setMacro(e.target.value)} placeholder="SSH, HTTP, HTTPS…" className={inputCls} />
            <p className="text-xs text-gray-600 mt-1">PVE macros pre-fill proto/dport. See pve-firewall docs for full list.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Source (CIDR or alias)</label>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="0.0.0.0/0 or alias-name" className={inputCls + ' font-mono'} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Destination</label>
              <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="CIDR or alias" className={inputCls + ' font-mono'} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Protocol</label>
              <input value={proto} onChange={(e) => setProto(e.target.value)} placeholder="tcp, udp, icmp…" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Source port</label>
              <input value={sport} onChange={(e) => setSport(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Dest port</label>
              <input value={dport} onChange={(e) => setDport(e.target.value)} placeholder="22, 80, 443" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Interface (optional)</label>
              <input value={iface} onChange={(e) => setIface(e.target.value)} placeholder="vmbr0, net0" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Log level</label>
              <select value={log} onChange={(e) => setLog(e.target.value as typeof log)} className={inputCls}>
                <option value="nolog">no log</option>
                <option value="info">info</option>
                <option value="notice">notice</option>
                <option value="warning">warning</option>
                <option value="err">err</option>
                <option value="crit">crit</option>
                <option value="alert">alert</option>
                <option value="emerg">emerg</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Comment</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} className="rounded border-gray-600" />
            Enabled
          </label>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={saveM.isPending} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition disabled:opacity-40">Cancel</button>
          <button
            onClick={submit}
            disabled={saveM.isPending || !action}
            className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-40')}
          >
            {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

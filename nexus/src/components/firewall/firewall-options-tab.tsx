'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { Loader2, Save } from 'lucide-react';
import { getOptions, updateOptions, scopeKey, type FirewallScope } from './firewall-scope';
import type { FirewallOptionsPublic } from '@/types/proxmox';

interface FirewallOptionsTabProps {
  scope: FirewallScope;
}

export function FirewallOptionsTab({ scope }: FirewallOptionsTabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const keyBase = scopeKey(scope);

  const { data, isLoading } = useQuery({
    queryKey: [...keyBase, 'options'],
    queryFn: () => getOptions(scope),
  });

  const [draft, setDraft] = useState<FirewallOptionsPublic>({});
  useEffect(() => { if (data) setDraft(data); }, [data]);

  const saveM = useMutation({
    mutationFn: (opts: Partial<FirewallOptionsPublic>) => updateOptions(scope, opts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...keyBase, 'options'] });
      toast.success('Options saved');
    },
    onError: (err) => toast.error('Save failed', err instanceof Error ? err.message : String(err)),
  });

  const set = <K extends keyof FirewallOptionsPublic>(key: K, value: FirewallOptionsPublic[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = () => {
    // Strip digest — PVE uses it for staleness check but we want to overwrite current view.
    const { digest: _digest, ...rest } = draft;
    saveM.mutate(rest);
  };

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

  if (isLoading) {
    return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  }

  const showVMFields = scope.kind === 'vm' || scope.kind === 'ct';

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="studio-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">General</h3>

        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.enable ?? false}
            onChange={(e) => set('enable', e.target.checked)}
            className="rounded border-gray-600"
          />
          Firewall enabled
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Default policy (inbound)</label>
            <select value={draft.policy_in ?? 'DROP'} onChange={(e) => set('policy_in', e.target.value as FirewallOptionsPublic['policy_in'])} className={inputCls}>
              <option value="ACCEPT">ACCEPT</option>
              <option value="DROP">DROP</option>
              <option value="REJECT">REJECT</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Default policy (outbound)</label>
            <select value={draft.policy_out ?? 'ACCEPT'} onChange={(e) => set('policy_out', e.target.value as FirewallOptionsPublic['policy_out'])} className={inputCls}>
              <option value="ACCEPT">ACCEPT</option>
              <option value="DROP">DROP</option>
              <option value="REJECT">REJECT</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Log level (inbound)</label>
            <input value={draft.log_level_in ?? ''} onChange={(e) => set('log_level_in', e.target.value)} placeholder="info" className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Log level (outbound)</label>
            <input value={draft.log_level_out ?? ''} onChange={(e) => set('log_level_out', e.target.value)} placeholder="info" className={inputCls} />
          </div>
        </div>
      </div>

      <div className="studio-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Protections</h3>
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={draft.nosmurfs ?? false} onChange={(e) => set('nosmurfs', e.target.checked)} className="rounded border-gray-600" />
          Drop smurf packets
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={draft.tcpflags ?? false} onChange={(e) => set('tcpflags', e.target.checked)} className="rounded border-gray-600" />
          Drop illegal TCP-flag combinations
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={draft.macfilter ?? false} onChange={(e) => set('macfilter', e.target.checked)} className="rounded border-gray-600" />
          MAC address filter
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={draft.ebtables ?? false} onChange={(e) => set('ebtables', e.target.checked)} className="rounded border-gray-600" />
          Use ebtables (bridge-level filtering)
        </label>
      </div>

      {showVMFields && (
        <div className="studio-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Guest-specific</h3>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={draft.dhcp ?? false} onChange={(e) => set('dhcp', e.target.checked)} className="rounded border-gray-600" />
            Allow DHCP
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={draft.ipfilter ?? false} onChange={(e) => set('ipfilter', e.target.checked)} className="rounded border-gray-600" />
            IP filter (restrict to assigned IP only)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={draft.ndp ?? false} onChange={(e) => set('ndp', e.target.checked)} className="rounded border-gray-600" />
            Allow NDP (IPv6)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={draft.radv ?? false} onChange={(e) => set('radv', e.target.checked)} className="rounded border-gray-600" />
            Allow router advertisements (IPv6)
          </label>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={saveM.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm rounded-lg transition disabled:opacity-40"
        >
          {saveM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save options
        </button>
      </div>
    </div>
  );
}

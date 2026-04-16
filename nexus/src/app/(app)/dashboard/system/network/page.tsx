'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/node-context';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Save, AlertTriangle, CheckCircle, RotateCcw, Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NetworkIfacePublic, NetworkIfaceParamsPublic } from '@/types/proxmox';

type IfaceType = 'bridge' | 'bond' | 'vlan' | 'eth';

const TYPE_COLORS: Record<string, 'success' | 'warning' | 'outline' | 'danger'> = {
  bridge: 'success',
  bond: 'warning',
  OVSBridge: 'outline',
  OVSBond: 'outline',
  eth: 'outline',
  vlan: 'outline',
};

function IfaceForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<NetworkIfaceParamsPublic & { iface: string }>;
  onSave: (params: NetworkIfaceParamsPublic & { iface: string }) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [type, setType] = useState<IfaceType>((initial?.type as IfaceType) ?? 'bridge');
  const [iface, setIface] = useState(initial?.iface ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [netmask, setNetmask] = useState(initial?.netmask ?? '');
  const [gateway, setGateway] = useState(initial?.gateway ?? '');
  const [autostart, setAutostart] = useState<boolean>(initial?.autostart !== false);
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [bridgePorts, setBridgePorts] = useState(initial?.bridge_ports ?? '');
  const [bondMode, setBondMode] = useState(initial?.bond_mode ?? 'active-backup');
  const [slaves, setSlaves] = useState(initial?.slaves ?? '');
  const [vlanDev, setVlanDev] = useState(initial?.['vlan-raw-device'] ?? '');
  const [vlanId, setVlanId] = useState(String(initial?.['vlan-id'] ?? ''));

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-orange-500/50';
  const labelCls = 'text-xs text-zinc-500 block mb-1';

  function handleSave() {
    const params: NetworkIfaceParamsPublic & { iface: string } = { type, iface, address, netmask, gateway, autostart, comments };
    if (type === 'bridge') { params.bridge_ports = bridgePorts; params.bridge_stp = 'off'; params.bridge_fd = 0; }
    if (type === 'bond') { params.bond_mode = bondMode; params.slaves = slaves; }
    if (type === 'vlan') { params['vlan-raw-device'] = vlanDev; params['vlan-id'] = Number(vlanId); }
    onSave(params);
  }

  return (
    <div className="space-y-3">
      {!initial?.iface && (
        <>
          <div>
            <label className={labelCls}>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as IfaceType)} className={inputCls}>
              <option value="bridge">Bridge</option>
              <option value="bond">Bond</option>
              <option value="vlan">VLAN</option>
              <option value="eth">Ethernet</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Interface Name</label>
            <input value={iface} onChange={(e) => setIface(e.target.value)} placeholder="e.g. vmbr1" className={inputCls} />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>IP Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.10" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Netmask</label>
          <input value={netmask} onChange={(e) => setNetmask(e.target.value)} placeholder="255.255.255.0" className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Gateway</label>
        <input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="192.168.1.1" className={inputCls} />
      </div>

      {type === 'bridge' && (
        <div>
          <label className={labelCls}>Bridge Ports</label>
          <input value={bridgePorts} onChange={(e) => setBridgePorts(e.target.value)} placeholder="e.g. eth0" className={inputCls} />
        </div>
      )}

      {type === 'bond' && (
        <>
          <div>
            <label className={labelCls}>Slaves</label>
            <input value={slaves} onChange={(e) => setSlaves(e.target.value)} placeholder="e.g. eth0 eth1" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Bond Mode</label>
            <select value={bondMode} onChange={(e) => setBondMode(e.target.value)} className={inputCls}>
              <option value="active-backup">active-backup</option>
              <option value="balance-rr">balance-rr</option>
              <option value="balance-xor">balance-xor</option>
              <option value="802.3ad">802.3ad (LACP)</option>
              <option value="balance-tlb">balance-tlb</option>
              <option value="balance-alb">balance-alb</option>
            </select>
          </div>
        </>
      )}

      {type === 'vlan' && (
        <>
          <div>
            <label className={labelCls}>Raw Device</label>
            <input value={vlanDev} onChange={(e) => setVlanDev(e.target.value)} placeholder="e.g. eth0" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>VLAN Tag</label>
            <input type="number" value={vlanId} onChange={(e) => setVlanId(e.target.value)} placeholder="e.g. 100" className={inputCls} />
          </div>
        </>
      )}

      <div>
        <label className={labelCls}>Comments</label>
        <input value={comments} onChange={(e) => setComments(e.target.value)} className={inputCls} />
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} className="rounded border-gray-600" />
        Autostart on boot
      </label>

      <div className="flex gap-3 justify-end pt-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving || (!initial?.iface && !iface)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-40"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
      </div>
    </div>
  );
}

export default function NetworkPage() {
  const { node } = useSystemNode();
  const qc = useQueryClient();
  const toast = useToast();
  const [selectedIface, setSelectedIface] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hasPending, setHasPending] = useState(false);

  const { data: ifaces, isLoading } = useQuery({
    queryKey: ['network', node],
    queryFn: () => api.networkIfaces.list(node),
    enabled: !!node,
    refetchInterval: 15_000,
  });

  const list = ifaces ?? [];
  const selected = list.find((i) => i.iface === selectedIface);

  const markPending = () => setHasPending(true);

  const createM = useMutation({
    mutationFn: (params: NetworkIfaceParamsPublic) => api.networkIfaces.create(node, params),
    onSuccess: () => {
      setShowCreate(false);
      markPending();
      qc.invalidateQueries({ queryKey: ['network', node] });
      toast.success('Interface created', 'Apply changes to activate.');
    },
    onError: (err) => toast.error('Create failed', err instanceof Error ? err.message : String(err)),
  });

  const updateM = useMutation({
    mutationFn: (params: Partial<NetworkIfaceParamsPublic>) =>
      api.networkIfaces.update(node, selectedIface!, params),
    onSuccess: () => {
      setEditing(false);
      markPending();
      qc.invalidateQueries({ queryKey: ['network', node] });
      toast.success('Interface updated', 'Apply changes to activate.');
    },
    onError: (err) => toast.error('Update failed', err instanceof Error ? err.message : String(err)),
  });

  const deleteM = useMutation({
    mutationFn: () => api.networkIfaces.delete(node, selectedIface!),
    onSuccess: () => {
      setSelectedIface(null);
      setShowDeleteConfirm(false);
      markPending();
      qc.invalidateQueries({ queryKey: ['network', node] });
      toast.success('Interface removed', 'Apply changes to activate.');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const applyM = useMutation({
    mutationFn: () => api.networkIfaces.apply(node),
    onSuccess: () => {
      setHasPending(false);
      setShowApplyConfirm(false);
      qc.invalidateQueries({ queryKey: ['network', node] });
      toast.success('Network configuration applied', 'Changes are now live on the node.');
    },
    onError: (err) => toast.error('Apply failed', err instanceof Error ? err.message : String(err)),
  });

  const revertM = useMutation({
    mutationFn: () => api.networkIfaces.revert(node),
    onSuccess: () => {
      setHasPending(false);
      setShowRevertConfirm(false);
      qc.invalidateQueries({ queryKey: ['network', node] });
      toast.info('Pending network changes reverted');
    },
    onError: (err) => toast.error('Revert failed', err instanceof Error ? err.message : String(err)),
  });

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
        Select a node to manage network interfaces.
      </div>
    );
  }

  return (
    <>
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${selectedIface}?`}
          message={`This will remove interface "${selectedIface}" from the configuration. Apply changes to take effect.`}
          danger
          onConfirm={() => deleteM.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
      {showApplyConfirm && (
        <ConfirmDialog
          title="Apply network configuration?"
          message={`Applying changes on node "${node}" runs ifreload — if the new config is wrong the node may become unreachable. Continue?`}
          danger
          onConfirm={() => applyM.mutate()}
          onCancel={() => setShowApplyConfirm(false)}
        />
      )}
      {showRevertConfirm && (
        <ConfirmDialog
          title="Revert pending network changes?"
          message="All uncommitted interface edits will be discarded."
          onConfirm={() => revertM.mutate()}
          onCancel={() => setShowRevertConfirm(false)}
        />
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Network</h1>
          <p className="text-sm text-zinc-500">Manage interfaces on {node}</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setSelectedIface(null); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          New Interface
        </button>
      </div>

      {hasPending && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-300 flex-1">Pending network changes — not yet applied to the system.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowRevertConfirm(true)}
              disabled={revertM.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition"
            >
              {revertM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Revert
            </button>
            <button
              onClick={() => setShowApplyConfirm(true)}
              disabled={applyM.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-yellow-600 hover:bg-yellow-500 rounded-lg transition"
            >
              {applyM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              Apply Configuration
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[260px_1fr] gap-4">
        <div className="space-y-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          ) : (
            list.map((iface) => (
              <button
                key={iface.iface}
                onClick={() => { setSelectedIface(iface.iface); setEditing(false); setShowCreate(false); }}
                className={cn(
                  'w-full text-left bg-zinc-900 border rounded-lg p-3 transition',
                  selectedIface === iface.iface ? 'border-orange-500/50' : 'border-zinc-800/60 hover:border-zinc-800/60',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', iface.active ? 'bg-emerald-400' : 'bg-gray-600')} />
                  <span className="text-sm font-mono text-zinc-200 font-medium">{iface.iface}</span>
                  <Badge variant={TYPE_COLORS[iface.type] ?? 'outline'} className="ml-auto text-xs">{iface.type}</Badge>
                </div>
                {iface.address && <p className="text-xs text-zinc-500 font-mono pl-3.5">{iface.cidr ?? iface.address}</p>}
              </button>
            ))
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-5">
          {showCreate ? (
            <>
              <h3 className="text-sm font-semibold text-white mb-4">New Interface</h3>
              <IfaceForm
                onSave={(params) => createM.mutate(params)}
                onCancel={() => setShowCreate(false)}
                isSaving={createM.isPending}
              />
            </>
          ) : selected && !editing ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white font-mono">{selected.iface}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-zinc-800 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  ['Type', selected.type],
                  ['Status', selected.active ? 'Active' : 'Inactive'],
                  ['Autostart', selected.autostart ? 'Yes' : 'No'],
                  ['IP Address', selected.cidr ?? selected.address ?? '—'],
                  ['Netmask', selected.netmask ?? '—'],
                  ['Gateway', selected.gateway ?? '—'],
                  ['Bridge Ports', selected.bridge_ports ?? '—'],
                  ['Bond Mode', selected.bond_mode ?? '—'],
                  ['Comments', selected.comments ?? '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                    <dd className="text-zinc-200 font-mono text-xs mt-0.5">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : selected && editing ? (
            <>
              <h3 className="text-sm font-semibold text-white mb-4">Edit {selected.iface}</h3>
              <IfaceForm
                initial={{
                  iface: selected.iface,
                  type: selected.type as IfaceType,
                  address: selected.address,
                  netmask: selected.netmask,
                  gateway: selected.gateway,
                  autostart: selected.autostart,
                  comments: selected.comments,
                  bridge_ports: selected.bridge_ports,
                  bond_mode: selected.bond_mode,
                  'vlan-raw-device': selected['vlan-raw-device'],
                  'vlan-id': selected['vlan-id'],
                }}
                onSave={(params) => updateM.mutate(params)}
                onCancel={() => setEditing(false)}
                isSaving={updateM.isPending}
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-zinc-600 gap-2">
              <Network className="w-8 h-8" />
              <p className="text-sm">Select an interface or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

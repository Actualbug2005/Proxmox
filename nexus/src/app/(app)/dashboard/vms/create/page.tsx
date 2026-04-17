'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useNodes } from '@/hooks/use-cluster';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Loader2, Check, Monitor } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1 — General
  node: string;
  vmid: string;
  name: string;
  pool: string;
  // Step 2 — OS
  iso: string;
  ostype: string;
  // Step 3 — Hardware
  sockets: number;
  cores: number;
  memory: number;
  // Step 4 — Disk
  storage: string;
  diskSize: number;
  diskFormat: string;
  // Step 5 — Network
  bridge: string;
  netModel: string;
  firewall: boolean;
}

const defaults: WizardState = {
  node: '', vmid: '', name: '', pool: '',
  iso: '', ostype: 'l26',
  sockets: 1, cores: 2, memory: 2048,
  storage: 'local-lvm', diskSize: 32, diskFormat: 'raw',
  bridge: 'vmbr0', netModel: 'virtio', firewall: true,
};

const OS_TYPES = [
  { value: 'l26', label: 'Linux 6.x - 2.6 Kernel' },
  { value: 'l24', label: 'Linux 2.4 Kernel' },
  { value: 'win11', label: 'Windows 11/2022' },
  { value: 'win10', label: 'Windows 10/2016/2019' },
  { value: 'win8', label: 'Windows 8.x/2012' },
  { value: 'other', label: 'Other' },
];

const NET_MODELS = ['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3'];
const DISK_FORMATS = [
  { value: 'raw', label: 'Raw' },
  { value: 'qcow2', label: 'QCOW2 (thin)' },
  { value: 'vmdk', label: 'VMDK' },
];

const STEPS = ['General', 'OS', 'Hardware', 'Disk', 'Network', 'Confirm'];

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, min, max }: {
  value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; min?: number; max?: number;
}) {
  return (
    <input
      type={type} value={value} placeholder={placeholder}
      min={min} max={max}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50"
    />
  );
}

function Select({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50">
      {children}
    </select>
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function StepGeneral({ state, set, nextid }: { state: WizardState; set: (p: Partial<WizardState>) => void; nextid?: number }) {
  const { data: nodes } = useNodes();
  return (
    <div className="space-y-4">
      <Field label="Node">
        <Select value={state.node} onChange={(v) => set({ node: v })}>
          <option value="">Select node…</option>
          {(nodes ?? []).map((n) => {
            const name = n.node ?? n.id;
            return <option key={name} value={name}>{name}</option>;
          })}
        </Select>
      </Field>
      <Field label="VM ID">
        <Input type="number" value={state.vmid || (nextid ?? '')} onChange={(v) => set({ vmid: v })}
          placeholder={String(nextid ?? 'auto')} min={100} max={999999999} />
      </Field>
      <Field label="Name">
        <Input value={state.name} onChange={(v) => set({ name: v })} placeholder="my-vm" />
      </Field>
      <Field label="Resource Pool (optional)">
        <Input value={state.pool} onChange={(v) => set({ pool: v })} placeholder="leave blank for none" />
      </Field>
    </div>
  );
}

function StepOS({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { data: storages } = useQuery({
    queryKey: ['node', state.node, 'storage', 'iso'],
    queryFn: () => api.storage.listWithContent(state.node, 'iso'),
    enabled: !!state.node,
  });

  const isoStorages = storages ?? [];

  const [isoStorage, setIsoStorage] = useState('');

  const { data: isoContent } = useQuery({
    queryKey: ['storage', state.node, isoStorage, 'iso'],
    queryFn: () => api.storage.content(state.node, isoStorage, 'iso'),
    enabled: !!state.node && !!isoStorage,
  });

  return (
    <div className="space-y-4">
      <Field label="ISO Storage">
        <Select value={isoStorage} onChange={setIsoStorage}>
          <option value="">Select storage…</option>
          {isoStorages.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
        </Select>
      </Field>
      <Field label="ISO Image">
        <Select value={state.iso} onChange={(v) => set({ iso: v })}>
          <option value="">No ISO (boot from network)</option>
          {(isoContent ?? []).map((c) => (
            <option key={c.volid} value={c.volid}>{c.name ?? c.volid.split('/').pop()}</option>
          ))}
        </Select>
      </Field>
      <Field label="Guest OS Type">
        <Select value={state.ostype} onChange={(v) => set({ ostype: v })}>
          {OS_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
    </div>
  );
}

function StepHardware({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Sockets">
          <Input type="number" value={state.sockets} onChange={(v) => set({ sockets: Number(v) })} min={1} max={4} />
        </Field>
        <Field label="Cores per Socket">
          <Input type="number" value={state.cores} onChange={(v) => set({ cores: Number(v) })} min={1} max={128} />
        </Field>
      </div>
      <Field label="Memory (MB)">
        <Input type="number" value={state.memory} onChange={(v) => set({ memory: Number(v) })} min={256} />
      </Field>
      <p className="text-xs text-zinc-600">
        Total vCPUs: {state.sockets * state.cores} · Memory: {(state.memory / 1024).toFixed(1)} GB
      </p>
    </div>
  );
}

function StepDisk({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { data: storages } = useQuery({
    queryKey: ['node', state.node, 'storage'],
    queryFn: () => api.storage.list(state.node),
    enabled: !!state.node,
  });

  const diskStorages = (storages ?? []).filter((s) =>
    !s.content || s.content.includes('images') || s.content.includes('rootdir'),
  );

  return (
    <div className="space-y-4">
      <Field label="Storage">
        <Select value={state.storage} onChange={(v) => set({ storage: v })}>
          {diskStorages.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>)}
          {diskStorages.length === 0 && <option value="local-lvm">local-lvm</option>}
        </Select>
      </Field>
      <Field label="Disk Size (GB)">
        <Input type="number" value={state.diskSize} onChange={(v) => set({ diskSize: Number(v) })} min={1} />
      </Field>
      <Field label="Format">
        <Select value={state.diskFormat} onChange={(v) => set({ diskFormat: v })}>
          {DISK_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
      </Field>
    </div>
  );
}

function StepNetwork({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { data: networks } = useQuery({
    queryKey: ['node', state.node, 'network'],
    queryFn: () => api.network.list(state.node, 'bridge'),
    enabled: !!state.node,
  });
  const bridges = networks ?? [];

  return (
    <div className="space-y-4">
      <Field label="Bridge">
        <Select value={state.bridge} onChange={(v) => set({ bridge: v })}>
          {bridges.length > 0
            ? bridges.map((b) => <option key={b.iface} value={b.iface}>{b.iface}</option>)
            : <option value="vmbr0">vmbr0</option>}
        </Select>
      </Field>
      <Field label="Network Model">
        <Select value={state.netModel} onChange={(v) => set({ netModel: v })}>
          {NET_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={state.firewall} onChange={(e) => set({ firewall: e.target.checked })}
          className="rounded border-gray-600" />
        Enable Firewall
      </label>
    </div>
  );
}

function StepConfirm({ state }: { state: WizardState }) {
  const rows: [string, string][] = [
    ['Node', state.node],
    ['VM ID', state.vmid || 'auto'],
    ['Name', state.name || '(unnamed)'],
    ['OS Type', OS_TYPES.find((o) => o.value === state.ostype)?.label ?? state.ostype],
    ['CPU', `${state.sockets} socket × ${state.cores} cores = ${state.sockets * state.cores} vCPUs`],
    ['Memory', `${state.memory} MB`],
    ['Disk', `${state.storage}:${state.diskSize}GB (${state.diskFormat})`],
    ['Network', `${state.netModel} on ${state.bridge}${state.firewall ? ' (fw)' : ''}`],
    ['ISO', state.iso || 'none'],
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-400 mb-4">Review your settings before creating the VM.</p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between py-2 border-b border-zinc-800/60 last:border-0">
          <span className="text-xs text-zinc-500">{label}</span>
          <span className="text-sm text-zinc-200 font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export default function CreateVMPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(defaults);
  const [error, setError] = useState('');

  const { data: nextid } = useQuery({ queryKey: ['nextid'], queryFn: () => api.cluster.nextid() });

  function set(patch: Partial<WizardState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  const createM = useMutation({
    mutationFn: () => {
      const vmid = Number(state.vmid) || nextid!;
      const node = state.node;
      const net0 = `${state.netModel}=auto,bridge=${state.bridge}${state.firewall ? ',firewall=1' : ''}`;
      const scsi0 = `${state.storage}:${state.diskSize},format=${state.diskFormat}`;
      return api.vms.create(node, {
        vmid,
        name: state.name,
        sockets: state.sockets,
        cores: state.cores,
        memory: state.memory,
        net0,
        scsi0,
        ...(state.iso ? { ide2: `${state.iso},media=cdrom` } : {}),
        ostype: state.ostype,
        agent: 1,
        onboot: 0,
        ...(state.pool ? { pool: state.pool } : {}),
      });
    },
    onSuccess: () => router.push('/dashboard/vms'),
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create VM'),
  });

  const canNext = () => {
    if (step === 0 && !state.node) return false;
    return true;
  };

  const stepComponents = [
    <StepGeneral key={0} state={state} set={set} nextid={nextid} />,
    <StepOS key={1} state={state} set={set} />,
    <StepHardware key={2} state={state} set={set} />,
    <StepDisk key={3} state={state} set={set} />,
    <StepNetwork key={4} state={state} set={set} />,
    <StepConfirm key={5} state={state} />,
  ];

  const isLast = step === STEPS.length - 1;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/dashboard/vms')} className="text-zinc-500 hover:text-zinc-300 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Create Virtual Machine</h1>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition',
                i < step ? 'bg-zinc-100 text-white' :
                i === step ? 'bg-white/10 border-2 border-zinc-200 text-indigo-400' :
                'bg-zinc-800 text-zinc-600',
              )}>
                {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn('text-xs mt-1 whitespace-nowrap', i === step ? 'text-indigo-400' : 'text-zinc-600')}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('flex-1 h-px mx-2 mb-4', i < step ? 'bg-zinc-100/40' : 'bg-zinc-800')} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="studio-card p-6">
        <h2 className="text-sm font-semibold text-white mb-5">{STEPS[step]}</h2>
        {stepComponents[step]}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => step > 0 ? setStep((s) => s - 1) : router.push('/dashboard/vms')}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-800 text-zinc-300 text-sm rounded-lg transition"
        >
          <ChevronLeft className="w-4 h-4" />
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {isLast ? (
          <button
            onClick={() => createM.mutate()}
            disabled={createM.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm font-medium rounded-lg transition disabled:opacity-50"
          >
            {createM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Create VM
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm font-medium rounded-lg transition disabled:opacity-50"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useNodes } from '@/hooks/use-cluster';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Loader2, Check, Box } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  // General
  node: string;
  vmid: string;
  hostname: string;
  password: string;
  confirmPassword: string;
  unprivileged: boolean;
  pool: string;
  // Template
  tmplStorage: string;
  ostemplate: string;
  // Resources
  cores: number;
  memory: number;
  swap: number;
  // Disk
  rootfsStorage: string;
  rootfsSize: number;
  // Network
  bridge: string;
  ipMode: 'dhcp' | 'static';
  ip: string;
  gw: string;
  ip6: string;
  dns: string;
}

const defaults: WizardState = {
  node: '', vmid: '', hostname: '', password: '', confirmPassword: '',
  unprivileged: true, pool: '',
  tmplStorage: '', ostemplate: '',
  cores: 1, memory: 512, swap: 512,
  rootfsStorage: 'local-lvm', rootfsSize: 8,
  bridge: 'vmbr0', ipMode: 'dhcp', ip: '', gw: '', ip6: '', dns: '',
};

const STEPS = ['General', 'Template', 'Resources', 'Network', 'Confirm'];

// ── Shared inputs ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, min }: {
  value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; min?: number;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder} min={min}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-orange-500/50" />
  );
}

function Select({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50">
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
      <Field label="CT ID">
        <Input type="number" value={state.vmid || (nextid ?? '')} onChange={(v) => set({ vmid: v })}
          placeholder={String(nextid ?? 'auto')} min={100} />
      </Field>
      <Field label="Hostname">
        <Input value={state.hostname} onChange={(v) => set({ hostname: v })} placeholder="my-container" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Password">
          <Input type="password" value={state.password} onChange={(v) => set({ password: v })} placeholder="root password" />
        </Field>
        <Field label="Confirm Password">
          <Input type="password" value={state.confirmPassword} onChange={(v) => set({ confirmPassword: v })} placeholder="confirm" />
        </Field>
      </div>
      {state.password && state.confirmPassword && state.password !== state.confirmPassword && (
        <p className="text-xs text-red-400">Passwords do not match</p>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="checkbox" checked={state.unprivileged} onChange={(e) => set({ unprivileged: e.target.checked })}
          className="rounded border-gray-600" />
        Unprivileged container (recommended)
      </label>
      <Field label="Resource Pool (optional)">
        <Input value={state.pool} onChange={(v) => set({ pool: v })} placeholder="leave blank for none" />
      </Field>
    </div>
  );
}

function StepTemplate({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { data: storages } = useQuery({
    queryKey: ['node', state.node, 'storage', 'vztmpl'],
    queryFn: () => api.storage.listWithContent(state.node, 'vztmpl'),
    enabled: !!state.node,
  });

  const { data: templates } = useQuery({
    queryKey: ['storage', state.node, state.tmplStorage, 'vztmpl'],
    queryFn: () => api.storage.content(state.node, state.tmplStorage, 'vztmpl'),
    enabled: !!state.node && !!state.tmplStorage,
  });

  return (
    <div className="space-y-4">
      <Field label="Template Storage">
        <Select value={state.tmplStorage} onChange={(v) => set({ tmplStorage: v, ostemplate: '' })}>
          <option value="">Select storage…</option>
          {(storages ?? []).map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
        </Select>
      </Field>
      <Field label="Template">
        <Select value={state.ostemplate} onChange={(v) => set({ ostemplate: v })}>
          <option value="">Select template…</option>
          {(templates ?? []).map((t) => (
            <option key={t.volid} value={t.volid}>
              {t.name ?? t.volid.split('/').pop()}
            </option>
          ))}
        </Select>
      </Field>
      {!state.tmplStorage && (
        <p className="text-xs text-gray-600">
          Select a storage that contains CT templates. You can download templates from the Proxmox web interface.
        </p>
      )}

      {/* Disk config here since it's tied to template selection */}
      <div className="pt-2 border-t border-gray-800">
        <p className="text-xs font-medium text-gray-400 mb-3">Root Disk</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Storage">
            <StorageSelect node={state.node} value={state.rootfsStorage} onChange={(v) => set({ rootfsStorage: v })} />
          </Field>
          <Field label="Disk Size (GB)">
            <Input type="number" value={state.rootfsSize} onChange={(v) => set({ rootfsSize: Number(v) })} min={1} />
          </Field>
        </div>
      </div>
    </div>
  );
}

function StorageSelect({ node, value, onChange }: { node: string; value: string; onChange: (v: string) => void }) {
  const { data: storages } = useQuery({
    queryKey: ['node', node, 'storage'],
    queryFn: () => api.storage.list(node),
    enabled: !!node,
  });
  const diskStorages = (storages ?? []).filter((s) =>
    !s.content || s.content.includes('rootdir') || s.content.includes('images'),
  );
  return (
    <Select value={value} onChange={onChange}>
      {diskStorages.length > 0
        ? diskStorages.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)
        : <option value="local-lvm">local-lvm</option>}
    </Select>
  );
}

function StepResources({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  return (
    <div className="space-y-4">
      <Field label="CPU Cores">
        <Input type="number" value={state.cores} onChange={(v) => set({ cores: Number(v) })} min={1} max={128} />
      </Field>
      <Field label="Memory (MB)">
        <Input type="number" value={state.memory} onChange={(v) => set({ memory: Number(v) })} min={64} />
      </Field>
      <Field label="Swap (MB)">
        <Input type="number" value={state.swap} onChange={(v) => set({ swap: Number(v) })} min={0} />
      </Field>
      <p className="text-xs text-gray-600">
        Memory: {(state.memory / 1024).toFixed(2)} GB · Swap: {(state.swap / 1024).toFixed(2)} GB
      </p>
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
      <Field label="IP Configuration">
        <Select value={state.ipMode} onChange={(v) => set({ ipMode: v as 'dhcp' | 'static' })}>
          <option value="dhcp">DHCP</option>
          <option value="static">Static</option>
        </Select>
      </Field>
      {state.ipMode === 'static' && (
        <>
          <Field label="IP Address (CIDR, e.g. 192.168.1.100/24)">
            <Input value={state.ip} onChange={(v) => set({ ip: v })} placeholder="192.168.1.100/24" />
          </Field>
          <Field label="Gateway">
            <Input value={state.gw} onChange={(v) => set({ gw: v })} placeholder="192.168.1.1" />
          </Field>
        </>
      )}
      <Field label="DNS Nameserver (optional)">
        <Input value={state.dns} onChange={(v) => set({ dns: v })} placeholder="8.8.8.8" />
      </Field>
    </div>
  );
}

function StepConfirm({ state }: { state: WizardState }) {
  const rows: [string, string][] = [
    ['Node', state.node],
    ['CT ID', state.vmid || 'auto'],
    ['Hostname', state.hostname || '(unnamed)'],
    ['Unprivileged', state.unprivileged ? 'Yes' : 'No'],
    ['Template', state.ostemplate ? state.ostemplate.split('/').pop()! : 'none'],
    ['CPU', `${state.cores} core${state.cores !== 1 ? 's' : ''}`],
    ['Memory', `${state.memory} MB`],
    ['Swap', `${state.swap} MB`],
    ['Root Disk', `${state.rootfsStorage}:${state.rootfsSize}GB`],
    ['Network', state.ipMode === 'dhcp' ? `${state.bridge} (DHCP)` : `${state.bridge} ${state.ip}`],
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-400 mb-4">Review your settings before creating the container.</p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between py-2 border-b border-gray-800/60 last:border-0">
          <span className="text-xs text-gray-500">{label}</span>
          <span className="text-sm text-gray-200 font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export default function CreateCTPage() {
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
      const net0 = `name=eth0,bridge=${state.bridge},${
        state.ipMode === 'dhcp' ? 'ip=dhcp' : `ip=${state.ip}${state.gw ? `,gw=${state.gw}` : ''}`
      }`;
      const rootfs = `${state.rootfsStorage}:${state.rootfsSize}`;
      return api.containers.create(state.node, {
        vmid,
        hostname: state.hostname,
        ostemplate: state.ostemplate,
        password: state.password,
        cores: state.cores,
        memory: state.memory,
        swap: state.swap,
        rootfs,
        net0,
        unprivileged: state.unprivileged ? 1 : 0,
        ...(state.dns ? { nameserver: state.dns } : {}),
        ...(state.pool ? { pool: state.pool } : {}),
        onboot: 0,
      });
    },
    onSuccess: () => router.push('/dashboard/cts'),
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create container'),
  });

  const canNext = () => {
    if (step === 0) {
      if (!state.node || !state.hostname) return false;
      if (state.password !== state.confirmPassword) return false;
      if (!state.password) return false;
    }
    if (step === 1 && !state.ostemplate) return false;
    return true;
  };

  const stepComponents = [
    <StepGeneral key={0} state={state} set={set} nextid={nextid} />,
    <StepTemplate key={1} state={state} set={set} />,
    <StepResources key={2} state={state} set={set} />,
    <StepNetwork key={3} state={state} set={set} />,
    <StepConfirm key={4} state={state} />,
  ];

  const isLast = step === STEPS.length - 1;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/dashboard/cts')} className="text-gray-500 hover:text-gray-300 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Box className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-semibold text-white">Create Container</h1>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition',
                i < step ? 'bg-orange-500 text-white' :
                i === step ? 'bg-orange-500/20 border-2 border-orange-500 text-orange-400' :
                'bg-gray-800 text-gray-600',
              )}>
                {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn('text-xs mt-1 whitespace-nowrap', i === step ? 'text-orange-400' : 'text-gray-600')}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('flex-1 h-px mx-2 mb-4', i < step ? 'bg-orange-500/40' : 'bg-gray-800')} />
            )}
          </div>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-5">{STEPS[step]}</h2>
        {stepComponents[step]}
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="flex justify-between">
        <button
          onClick={() => step > 0 ? setStep((s) => s - 1) : router.push('/dashboard/cts')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition"
        >
          <ChevronLeft className="w-4 h-4" />
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {isLast ? (
          <button
            onClick={() => createM.mutate()}
            disabled={createM.isPending}
            className="flex items-center gap-2 px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
          >
            {createM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Create CT
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

/**
 * CloneWizard — template VM clone with cloud-init configuration.
 *
 * Three steps:
 *   1. Clone params  (newid, name, target, full)
 *   2. Cloud-init    (hostname, user, password, ssh keys, NIC0, DNS)
 *   3. Review        (summary + big Create button)
 *
 * Submit flow — the reason this wizard exists instead of a one-shot
 * dialog:
 *
 *     api.vms.clone() → UPID
 *        ↓ useTaskCompletion polls every 2s
 *     task terminal (ok)
 *        ↓
 *     api.vms.updateConfig(targetNode, newid, cloudInitParams)
 *        ↓
 *     onSuccess → navigate to the new VM
 *
 * Without the wait, updateConfig races PVE's VM lock and returns 403.
 *
 * Only mounted for template VMs; regular VMs keep the minimal inline
 * CloneDialog elsewhere in vms/[node]/[vmid]/page.tsx.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Server,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { useTaskCompletion } from '@/hooks/use-task-completion';
import {
  CloudInitForm,
  EMPTY_CLOUD_INIT_STATE,
  cloudInitStateToUpdateParams,
  type CloudInitFormState,
} from '@/components/cloud-init/cloud-init-form';
import type { ClusterResourcePublic } from '@/types/proxmox';

// ─── Props ───────────────────────────────────────────────────────────────────

interface CloneWizardProps {
  sourceNode: string;
  sourceVmid: number;
  sourceName: string;
  onClose: () => void;
  /** Called after the clone AND post-clone config update complete. */
  onSuccess?: (newid: number, targetNode: string) => void;
}

const STEP_LABELS = ['Clone', 'Cloud-Init', 'Review'] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function CloneWizard({
  sourceNode,
  sourceVmid,
  sourceName,
  onClose,
  onSuccess,
}: CloneWizardProps) {
  const toast = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState<0 | 1 | 2>(0);

  // ── Step 1 state
  const { data: nextidHint } = useQuery({
    queryKey: ['nextid'],
    queryFn: () => api.cluster.nextid(),
  });
  const [newidRaw, setNewidRaw] = useState<string>('');
  const [name, setName] = useState<string>(`${sourceName}-clone`);
  const [targetNode, setTargetNode] = useState<string>(sourceNode);
  const [fullClone, setFullClone] = useState<boolean>(true);

  const { data: resources } = useQuery({
    queryKey: ['cluster', 'resources'],
    queryFn: () => api.cluster.resources(),
  });
  const onlineNodes = (resources ?? []).filter(
    (r): r is ClusterResourcePublic & { type: 'node' } =>
      r.type === 'node' && r.status === 'online',
  );

  const newid = newidRaw ? Number(newidRaw) : nextidHint ?? 0;
  const step1Valid =
    Number.isInteger(newid) && newid > 0 && name.trim().length > 0 && !!targetNode;

  // ── Step 2 state
  const [cloud, setCloud] = useState<CloudInitFormState>(EMPTY_CLOUD_INIT_STATE);
  const [sshKeyErrors, setSshKeyErrors] = useState<string[] | undefined>(undefined);

  // Seed the hostname from the clone name ONCE (ref-gated so later name
  // edits don't clobber a user-typed hostname, and the setter doesn't
  // trip react-hooks/set-state-in-effect on every re-render).
  const hostnameSeededRef = useRef(false);
  useEffect(() => {
    if (hostnameSeededRef.current) return;
    if (cloud.hostname !== '' || !name.trim()) return;
    hostnameSeededRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot seed, ref-guarded
    setCloud((prev) => ({ ...prev, hostname: sanitizeHostname(name) }));
  }, [cloud.hostname, name]);

  // ── Submit flow: clone → wait → updateConfig
  const [cloneUpid, setCloneUpid] = useState<string | null>(null);
  const [configApplyError, setConfigApplyError] = useState<string | null>(null);
  // Ref-guarded fire-once: the effect that kicks off the config update
  // reads this ref, sets it true, then invokes the mutation. Using a ref
  // rather than state keeps the effect's setState count at zero (it only
  // calls applyConfigMutation.mutate, which is the mutation library's
  // state, not this component's).
  const configAppliedRef = useRef(false);

  const cloneMutation = useMutation({
    mutationFn: async () => {
      return api.vms.clone(sourceNode, sourceVmid, {
        newid,
        name: name.trim(),
        target: targetNode !== sourceNode ? targetNode : undefined,
        full: fullClone,
      });
    },
    onSuccess: (upid) => {
      setCloneUpid(upid);
    },
    onError: (err: Error) => {
      toast.error('Clone failed to start', err.message);
    },
  });

  const taskCompletion = useTaskCompletion(
    cloneUpid ? sourceNode : null,
    cloneUpid,
  );

  // Once the clone task terminates successfully, fire the config update.
  // Use a plain useMutation so the caller can surface its error separately
  // (the clone succeeded — we don't want to conflate it with config failure).
  const applyConfigMutation = useMutation({
    mutationFn: async () => {
      const translation = cloudInitStateToUpdateParams(cloud);
      if (!translation.ok) {
        throw new Error(translation.errors.join('; '));
      }
      // Nothing to send is a successful no-op. The new VM is cloned from the
      // template; if the user didn't fill any fields, the template defaults apply.
      if (translation.fieldCount === 0) return { applied: 0 };
      await api.vms.updateConfig(targetNode, newid, translation.params);
      return { applied: translation.fieldCount };
    },
  });

  useEffect(() => {
    if (configAppliedRef.current) return;
    if (taskCompletion.state !== 'done') return;
    if (!taskCompletion.result.ok) return; // clone failed — don't touch config
    configAppliedRef.current = true;
    applyConfigMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success('VM cloned and configured');
        qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
        onSuccess?.(newid, targetNode);
        onClose();
      },
      onError: (err: Error) => {
        setConfigApplyError(err.message);
      },
    });
  }, [taskCompletion.state, taskCompletion.result.ok, applyConfigMutation, newid, targetNode, qc, onClose, onSuccess, toast]);

  const inFlight =
    cloneMutation.isPending ||
    taskCompletion.state === 'waiting' ||
    applyConfigMutation.isPending;

  const cloneError =
    cloneMutation.error?.message ??
    (taskCompletion.state === 'done' && !taskCompletion.result.ok
      ? taskCompletion.result.exitstatus ?? 'Clone task failed'
      : null) ??
    (taskCompletion.state === 'timeout' ? 'Clone task timed out' : null) ??
    (taskCompletion.state === 'error' ? taskCompletion.result.error?.message ?? 'Task poll failed' : null);

  const submit = () => {
    // Pre-validate cloud-init so we don't fire the clone and then realise
    // the config can't be applied.
    const check = cloudInitStateToUpdateParams(cloud);
    if (!check.ok) {
      setSshKeyErrors(check.errors);
      setStep(1);
      return;
    }
    setSshKeyErrors(undefined);
    setCloneUpid(null);
    setConfigApplyError(null);
    configAppliedRef.current = false;
    cloneMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-[var(--color-fg-muted)]" />
            <h3 className="text-sm font-semibold text-white">
              Clone template &ldquo;{sourceName}&rdquo;
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={inFlight}
            className="text-[var(--color-fg-subtle)] hover:text-white p-1 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <StepIndicator step={step} />

        <div className="mt-5 min-h-[280px]">
          {step === 0 && (
            <StepClone
              nextidHint={nextidHint}
              newidRaw={newidRaw}
              setNewidRaw={setNewidRaw}
              name={name}
              setName={setName}
              targetNode={targetNode}
              setTargetNode={setTargetNode}
              fullClone={fullClone}
              setFullClone={setFullClone}
              nodes={onlineNodes}
            />
          )}
          {step === 1 && (
            <div>
              <p className="text-xs text-[var(--color-fg-subtle)] mb-3">
                Applied after the clone task completes. Empty fields are not sent
                (the template&apos;s defaults apply). Changes may require a VM restart
                to take effect.
              </p>
              <CloudInitForm
                value={cloud}
                onChange={setCloud}
                sshKeyErrors={sshKeyErrors}
              />
            </div>
          )}
          {step === 2 && (
            <StepReview
              sourceNode={sourceNode}
              sourceVmid={sourceVmid}
              newid={newid}
              name={name}
              targetNode={targetNode}
              fullClone={fullClone}
              cloud={cloud}
              cloneState={
                cloneMutation.isPending
                  ? 'starting'
                  : cloneUpid && taskCompletion.state === 'waiting'
                    ? 'cloning'
                    : applyConfigMutation.isPending
                      ? 'configuring'
                      : cloneError
                        ? 'error'
                        : 'idle'
              }
              cloneError={cloneError}
              configError={configApplyError}
            />
          )}
        </div>

        {/* Nav row */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => (step > 0 ? setStep(((step - 1) as 0 | 1 | 2)) : onClose())}
            disabled={inFlight}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
            {step > 0 ? 'Back' : 'Cancel'}
          </button>
          {step < 2 && (
            <button
              onClick={() => setStep(((step + 1) as 0 | 1 | 2))}
              disabled={step === 0 ? !step1Valid : false}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium bg-zinc-300 hover:bg-zinc-200 text-zinc-900 rounded-lg transition disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {step === 2 && (
            <button
              onClick={submit}
              disabled={inFlight || !step1Valid}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg transition disabled:opacity-40"
            >
              {inFlight ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {inFlight ? 'Working…' : 'Create'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step indicator (lifted from migrate-wizard) ─────────────────────────────

function StepIndicator({ step }: { step: 0 | 1 | 2 }) {
  return (
    <div className="flex items-center gap-0">
      {STEP_LABELS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-initial">
            <div
              className={cn(
                'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition',
                done && 'bg-indigo-500 text-white',
                active && !done && 'bg-zinc-200 text-zinc-900 ring-2 ring-indigo-400 ring-offset-2 ring-offset-zinc-900',
                !done && !active && 'bg-[var(--color-overlay)] text-[var(--color-fg-subtle)]',
              )}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                'ml-2 text-xs font-medium',
                active ? 'text-[var(--color-fg)]' : done ? 'text-[var(--color-fg-muted)]' : 'text-[var(--color-fg-faint)]',
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div className={cn('flex-1 h-px mx-3', done ? 'bg-indigo-500/60' : 'bg-[var(--color-overlay)]')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Clone params ────────────────────────────────────────────────────

function StepClone({
  nextidHint,
  newidRaw,
  setNewidRaw,
  name,
  setName,
  targetNode,
  setTargetNode,
  fullClone,
  setFullClone,
  nodes,
}: {
  nextidHint: number | undefined;
  newidRaw: string;
  setNewidRaw: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  targetNode: string;
  setTargetNode: (v: string) => void;
  fullClone: boolean;
  setFullClone: (v: boolean) => void;
  nodes: Array<ClusterResourcePublic & { type: 'node' }>;
}) {
  const inputCls =
    'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">New VM ID</label>
          <input
            type="number"
            value={newidRaw}
            onChange={(e) => setNewidRaw(e.target.value)}
            placeholder={nextidHint ? String(nextidHint) : '…'}
            className={cn(inputCls, 'font-mono')}
          />
        </div>
        <div>
          <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Target node</label>
        <div className="relative">
          <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-fg-subtle)] pointer-events-none" />
          <select
            value={targetNode}
            onChange={(e) => setTargetNode(e.target.value)}
            className={cn(inputCls, 'pl-9 appearance-none')}
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.node ?? n.id}>
                {n.node ?? n.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--color-fg-secondary)] cursor-pointer">
        <input
          type="checkbox"
          checked={fullClone}
          onChange={(e) => setFullClone(e.target.checked)}
          className="rounded border-gray-600"
        />
        Full clone (copy disks — slower, but the clone is independent of the template)
      </label>
    </div>
  );
}

// ─── Step 3: Review + live task state ────────────────────────────────────────

function StepReview({
  sourceNode,
  sourceVmid,
  newid,
  name,
  targetNode,
  fullClone,
  cloud,
  cloneState,
  cloneError,
  configError,
}: {
  sourceNode: string;
  sourceVmid: number;
  newid: number;
  name: string;
  targetNode: string;
  fullClone: boolean;
  cloud: CloudInitFormState;
  cloneState: 'idle' | 'starting' | 'cloning' | 'configuring' | 'error';
  cloneError: string | null;
  configError: string | null;
}) {
  const translation = cloudInitStateToUpdateParams(cloud);
  const fieldCount = translation.ok ? translation.fieldCount : 0;
  return (
    <div className="space-y-3">
      <div className="studio-card rounded-lg p-4 space-y-2">
        <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">Clone</div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--color-fg-subtle)]">From</dt>
            <dd className="font-mono text-[var(--color-fg-secondary)]">
              {sourceName(sourceNode, sourceVmid)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-fg-subtle)]">New VM</dt>
            <dd className="font-mono text-[var(--color-fg-secondary)]">{name} ({newid})</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-fg-subtle)]">Target node</dt>
            <dd className="font-mono text-[var(--color-fg-secondary)]">{targetNode}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-fg-subtle)]">Mode</dt>
            <dd className="text-[var(--color-fg-secondary)]">{fullClone ? 'Full clone' : 'Linked clone'}</dd>
          </div>
        </dl>
      </div>

      <div className="studio-card rounded-lg p-4 space-y-1">
        <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest mb-1">
          Cloud-Init — {fieldCount} field{fieldCount === 1 ? '' : 's'}
        </div>
        {fieldCount === 0 ? (
          <p className="text-sm text-[var(--color-fg-muted)]">No cloud-init fields set; template defaults apply.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {cloud.hostname && <Row label="Hostname (name)" value={cloud.hostname} mono />}
            {cloud.username && <Row label="Default user" value={cloud.username} mono />}
            {cloud.password && <Row label="Password" value="••••••••" />}
            {cloud.sshKeysRaw && <Row label="SSH keys" value={`${cloud.sshKeysRaw.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length} line(s)`} />}
            {cloud.nic0.ipv4Mode !== 'none' || cloud.nic0.ipv6Mode !== 'none' ? (
              <Row
                label="ipconfig0"
                value={translation.ok ? (translation.params.ipconfig0 ?? '—') : '—'}
                mono
              />
            ) : null}
            {cloud.nameserver && <Row label="Nameservers" value={cloud.nameserver} mono />}
            {cloud.searchdomain && <Row label="Search domain" value={cloud.searchdomain} mono />}
          </dl>
        )}
      </div>

      {/* Progress strip */}
      {cloneState !== 'idle' && (
        <div className="studio-card rounded-lg p-3 space-y-1.5">
          <ProgressStep
            done={cloneState === 'cloning' || cloneState === 'configuring'}
            active={cloneState === 'starting'}
            label="Starting clone task"
          />
          <ProgressStep
            done={cloneState === 'configuring'}
            active={cloneState === 'cloning'}
            label="Waiting for PVE to finish the clone"
          />
          <ProgressStep
            done={false}
            active={cloneState === 'configuring'}
            label="Applying cloud-init configuration"
          />
        </div>
      )}

      {(cloneError || configError) && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <div>
            {cloneError && <p className="text-red-300 font-medium">{cloneError}</p>}
            {configError && <p className="text-red-300 font-medium">Cloud-init: {configError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-fg-subtle)]">{label}</dt>
      <dd className={cn('text-[var(--color-fg-secondary)] truncate', mono && 'font-mono')} title={value}>
        {value}
      </dd>
    </div>
  );
}

function ProgressStep({
  done,
  active,
  label,
}: {
  done: boolean;
  active: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done ? (
        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      ) : active ? (
        <Loader2 className="w-3.5 h-3.5 text-indigo-300 animate-spin shrink-0" />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full border border-[var(--color-border-strong)] shrink-0" />
      )}
      <span className={cn(done ? 'text-[var(--color-fg-muted)]' : active ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-faint)]')}>
        {label}
      </span>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeHostname(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function sourceName(node: string, vmid: number): string {
  return `${node}:${vmid}`;
}

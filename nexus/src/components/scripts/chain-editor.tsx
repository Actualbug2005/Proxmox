'use client';

/**
 * Modal editor for a script chain.
 *
 * Shares the studio-card modal shell of ScheduleJobEditor and BackupJobEditor
 * so the three chain / schedule / backup editors feel the same. The
 * per-step row is custom — pick script + node, then optional drag-free
 * reorder via ↑/↓ (drag-and-drop was discarded as complexity without
 * value for chains that realistically have 2-8 steps).
 *
 * Steps are kept in local state and committed on Save. The PATCH route
 * re-checks ACL on any node that wasn't already in the chain.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/proxmox-client';
import { useDefaultNode } from '@/hooks/use-cluster';
import { useToast } from '@/components/ui/toast';
import { CronInput } from '@/components/dashboard/cron-input';
import { ScriptPicker, type PickedScript } from '@/components/scripts/script-picker';
import {
  useCreateChain,
  useUpdateChain,
  type ChainDto,
  type ChainStepInput,
  type ChainStepPolicy,
} from '@/hooks/use-chains';

interface ChainEditorProps {
  onClose: () => void;
  onSaved?: (chain: ChainDto) => void;
  initial?: ChainDto | null;
}

interface DraftStep {
  // Local-only stable id for React keys; not persisted.
  key: string;
  picked: PickedScript | null;
  node: string;
}

const inputCls =
  'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

function makeStep(defaults?: Partial<DraftStep>): DraftStep {
  return {
    key: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    picked: defaults?.picked ?? null,
    node: defaults?.node ?? '',
  };
}

export function ChainEditor({ onClose, onSaved, initial }: ChainEditorProps) {
  const toast = useToast();
  const isEdit = !!initial;
  const defaultNode = useDefaultNode();

  const { data: resources } = useQuery({
    queryKey: ['cluster', 'resources'],
    queryFn: () => api.cluster.resources(),
  });
  const nodes = useMemo(
    () => (resources ?? []).filter((r) => r.type === 'node' && r.status === 'online'),
    [resources],
  );

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [policy, setPolicy] = useState<ChainStepPolicy>(initial?.policy ?? 'halt-on-failure');
  const [schedule, setSchedule] = useState(initial?.schedule ?? '');
  const [scheduleOn, setScheduleOn] = useState(Boolean(initial?.schedule));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const [steps, setSteps] = useState<DraftStep[]>(() => {
    if (initial && initial.steps.length > 0) {
      return initial.steps.map((s) =>
        makeStep({
          picked: {
            slug: s.slug ?? '',
            scriptName: s.scriptName,
            scriptUrl: s.scriptUrl,
            method: s.method,
          },
          node: s.node,
        }),
      );
    }
    return [makeStep({ node: defaultNode ?? '' })];
  });

  const createM = useCreateChain();
  const updateM = useUpdateChain();
  const busy = createM.isPending || updateM.isPending;

  const canSubmit =
    !busy &&
    name.trim().length > 0 &&
    steps.length > 0 &&
    steps.every((s) => s.picked && s.node) &&
    (!scheduleOn || schedule.trim().length > 0);

  const setStepAt = (i: number, patch: Partial<DraftStep>) => {
    setSteps((prev) => prev.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  };

  const removeStep = (i: number) => {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const addStep = () => {
    setSteps((prev) => [...prev, makeStep({ node: defaultNode ?? '' })]);
  };

  const submit = () => {
    if (!canSubmit) return;

    const mapped: ChainStepInput[] = steps.map((s) => ({
      slug: s.picked!.slug || undefined,
      scriptName: s.picked!.scriptName,
      scriptUrl: s.picked!.scriptUrl,
      method: s.picked!.method,
      node: s.node,
    }));

    if (isEdit && initial) {
      updateM.mutate(
        {
          id: initial.id,
          patch: {
            name: name.trim(),
            description: description.trim() || undefined,
            policy,
            enabled,
            schedule: scheduleOn ? schedule.trim() : null,
            steps: mapped,
          },
        },
        {
          onSuccess: (data) => {
            toast.success('Chain updated');
            onSaved?.(data.chain);
            onClose();
          },
          onError: (err) => toast.error('Update failed', err.message),
        },
      );
    } else {
      createM.mutate(
        {
          name: name.trim(),
          description: description.trim() || undefined,
          policy,
          enabled,
          schedule: scheduleOn && schedule.trim() ? schedule.trim() : undefined,
          steps: mapped,
        },
        {
          onSuccess: (data) => {
            toast.success('Chain created');
            onSaved?.(data.chain);
            onClose();
          },
          onError: (err) => toast.error('Create failed', err.message),
        },
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-2xl shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-white">
              {isEdit ? 'Edit chain' : 'New script chain'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bootstrap media stack"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this chain does"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-500">On step failure</label>
            <div className="flex gap-2">
              <PolicyPill
                active={policy === 'halt-on-failure'}
                label="Halt on failure"
                onClick={() => setPolicy('halt-on-failure')}
              />
              <PolicyPill
                active={policy === 'continue'}
                label="Continue anyway"
                onClick={() => setPolicy('continue')}
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-zinc-500">Schedule (optional)</label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={scheduleOn}
                  onChange={(e) => setScheduleOn(e.target.checked)}
                  className="rounded border-gray-600"
                />
                Run on a cadence
              </label>
            </div>
            {scheduleOn && <CronInput value={schedule} onChange={setSchedule} />}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-600"
            />
            Enabled
          </label>

          {/* Steps */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs text-zinc-500">Steps</label>
              <button
                type="button"
                onClick={addStep}
                className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <Plus className="h-3 w-3" />
                Add step
              </button>
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div
                  key={step.key}
                  className="rounded-lg border border-zinc-800/60 bg-zinc-900/50 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-medium text-zinc-300">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-xs text-zinc-500">Step</span>
                    <button
                      type="button"
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(i, 1)}
                      disabled={i === steps.length - 1}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      disabled={steps.length <= 1}
                      className="rounded p-1 text-zinc-500 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]">
                    <ScriptPicker
                      value={step.picked}
                      onChange={(picked) => setStepAt(i, { picked })}
                    />
                    <select
                      value={step.node}
                      onChange={(e) => setStepAt(i, { node: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">Node…</option>
                      {nodes.map((n) => (
                        <option key={n.node ?? n.id} value={n.node ?? n.id}>
                          {n.node ?? n.id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-400 transition hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
              'bg-zinc-300 text-zinc-900 hover:bg-zinc-200 disabled:opacity-40',
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? 'Save' : 'Create chain'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PolicyPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs transition',
        active
          ? 'bg-zinc-100 text-zinc-900'
          : 'border border-zinc-800/60 bg-zinc-800/40 text-zinc-400 hover:text-zinc-200',
      )}
    >
      {label}
    </button>
  );
}

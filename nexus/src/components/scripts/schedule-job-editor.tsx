'use client';

/**
 * Modal editor for a community-script schedule.
 *
 * Mirrors the form patterns of BackupJobEditor (vanilla useState, CronInput,
 * studio-card modal shell, useMutation + toast) so both editors feel the
 * same even though they target different backends.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Loader2, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/proxmox-client';
import { useDefaultNode } from '@/hooks/use-cluster';
import { useToast } from '@/components/ui/toast';
import { CronInput } from '@/components/dashboard/cron-input';
import {
  useCreateScheduledJob,
  useUpdateScheduledJob,
  type ScheduledJobDto,
  type CreateScheduledJobInput,
  type UpdateScheduledJobInput,
} from '@/hooks/use-scheduled-jobs';

// ─── Props ───────────────────────────────────────────────────────────────────

interface ScheduleJobEditorProps {
  onClose: () => void;
  onSaved?: (job: ScheduledJobDto) => void;
  /**
   * Pre-populate for creating a schedule for a specific script (clicked
   * from the scripts page). Ignored when `initial` is set.
   */
  preset?: {
    slug?: string;
    scriptUrl: string;
    scriptName: string;
    method?: string;
    node?: string;
  };
  /** When set, the modal edits this record instead of creating a new one. */
  initial?: ScheduledJobDto | null;
}

const inputCls =
  'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

// ─── Component ───────────────────────────────────────────────────────────────

export function ScheduleJobEditor({
  onClose,
  onSaved,
  preset,
  initial,
}: ScheduleJobEditorProps) {
  const toast = useToast();
  const isEdit = !!initial;

  // Form state — vanilla useState to match BackupJobEditor convention.
  const [schedule, setSchedule] = useState(initial?.schedule ?? '0 2 * * *');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [nodeOverride, setNodeOverride] = useState<string | null>(
    initial?.node ?? preset?.node ?? null,
  );
  const [scriptName] = useState(initial?.scriptName ?? preset?.scriptName ?? '');
  const [slug] = useState(initial?.slug ?? preset?.slug);
  const [scriptUrl] = useState(initial?.scriptUrl ?? preset?.scriptUrl ?? '');
  const [method] = useState(initial?.method ?? preset?.method);

  const { data: resources } = useQuery({
    queryKey: ['cluster', 'resources'],
    queryFn: () => api.cluster.resources(),
  });
  const nodes = (resources ?? []).filter((r) => r.type === 'node' && r.status === 'online');
  const defaultNode = useDefaultNode();

  // Prefer the explicit override; fall back to the cluster's default node
  // whenever the user hasn't interacted. Keeps the dropdown populated on
  // first paint without needing a useEffect+setState dance.
  const node = nodeOverride ?? (isEdit ? '' : defaultNode ?? '');

  const createM = useCreateScheduledJob();
  const updateM = useUpdateScheduledJob();
  const busy = createM.isPending || updateM.isPending;

  const canSubmit = !!node && !!scriptUrl && !!scriptName && !!schedule && !busy;

  const submit = () => {
    if (!canSubmit) return;
    if (isEdit && initial) {
      const patch: UpdateScheduledJobInput = { schedule, enabled, node };
      updateM.mutate(
        { id: initial.id, patch },
        {
          onSuccess: (data) => {
            toast.success('Schedule updated');
            onSaved?.(data.job);
            onClose();
          },
          onError: (err) => toast.error('Update failed', err.message),
        },
      );
    } else {
      const input: CreateScheduledJobInput = {
        slug,
        scriptUrl,
        scriptName,
        node,
        method,
        schedule,
        enabled,
      };
      createM.mutate(input, {
        onSuccess: (data) => {
          toast.success('Schedule created');
          onSaved?.(data.job);
          onClose();
        },
        onError: (err) => toast.error('Create failed', err.message),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <div className="studio-card p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-white">
              {isEdit ? 'Edit schedule' : 'Schedule this script'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {scriptName && (
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-800/60 px-3 py-2 text-sm">
              <div className="text-zinc-200">{scriptName}</div>
              {slug && <div className="text-xs text-zinc-500 font-mono mt-0.5">{slug}</div>}
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Schedule</label>
            <CronInput value={schedule} onChange={setSchedule} />
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Node</label>
            <select
              value={node}
              onChange={(e) => setNodeOverride(e.target.value)}
              className={inputCls}
            >
              <option value="">Select…</option>
              {nodes.map((n) => (
                <option key={n.node ?? n.id} value={n.node ?? n.id}>
                  {n.node ?? n.id}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-600"
            />
            Enabled
          </label>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition',
              'bg-zinc-300 hover:bg-zinc-200 text-zinc-900 disabled:opacity-40',
            )}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

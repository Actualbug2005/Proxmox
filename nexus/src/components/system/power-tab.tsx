'use client';

/**
 * Node Power tab body.
 *
 * Extracted from `src/app/(app)/dashboard/system/power/page.tsx` for the
 * Plan D Task 2 tabbed shell. The /dashboard/system layout owns the outer
 * `p-6 space-y-6` wrapper AND the node-picker header; the old route keeps
 * only the page-level `<h1>` + subtitle chrome in the thin shell.
 *
 * No sub-tabs. The active node comes from the shared SystemNodeContext
 * populated by the system layout.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { formatUptime } from '@/lib/utils';
import { PowerOff, RotateCcw, Loader2, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

export function PowerTab() {
  const { node } = useSystemNode();
  const toast = useToast();
  const [pending, setPending] = useState<'reboot' | 'shutdown' | null>(null);

  const { data: status } = useQuery({
    queryKey: ['node', node, 'status'],
    queryFn: () => api.nodes.status(node),
    enabled: !!node,
    refetchInterval: POLL_INTERVALS.nodeStatus,
  });

  const powerM = useMutation({
    mutationFn: (command: 'reboot' | 'shutdown') => api.nodes.power(node, command),
    onSuccess: (_, command) => {
      setPending(null);
      toast.success(
        `${command === 'reboot' ? 'Reboot' : 'Shutdown'} initiated`,
        `Node ${node} will ${command === 'reboot' ? 'restart' : 'power off'} shortly.`,
      );
    },
    onError: (err) => toast.error('Power action failed', err instanceof Error ? err.message : String(err)),
  });

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--color-fg-subtle)] text-sm">
        Select a node to manage power.
      </div>
    );
  }

  return (
    <>
      {pending && (
        <ConfirmDialog
          title={`${pending === 'reboot' ? 'Reboot' : 'Shut down'} ${node}?`}
          message={
            pending === 'reboot'
              ? `This will reboot node "${node}". All running VMs and containers will be affected.`
              : `This will shut down node "${node}". All running VMs and containers will be stopped.`
          }
          danger={pending === 'shutdown'}
          onConfirm={() => powerM.mutate(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="studio-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[var(--color-fg-subtle)]" />
            <span className="text-xs text-[var(--color-fg-subtle)] font-medium uppercase tracking-widest">Uptime</span>
          </div>
          <p className="text-lg font-mono text-white">
            {status ? formatUptime(status.uptime ?? 0) : '—'}
          </p>
          <p className="text-xs text-[var(--color-fg-faint)] mt-1">{status?.pveversion ?? ''}</p>
        </div>

        <div className="studio-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <RotateCcw className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-[var(--color-fg-subtle)] font-medium uppercase tracking-widest">Reboot</span>
          </div>
          <p className="text-xs text-[var(--color-fg-subtle)] mb-4">Restart the node OS. VMs will be suspended or stopped depending on guest agent support.</p>
          <button
            onClick={() => setPending('reboot')}
            disabled={powerM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm rounded-lg transition disabled:opacity-40"
          >
            {powerM.isPending && pending === 'reboot' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            Reboot Node
          </button>
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-err)]/30 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <PowerOff className="w-4 h-4 text-[var(--color-err)]" />
            <span className="text-xs text-[var(--color-fg-subtle)] font-medium uppercase tracking-widest">Shutdown</span>
          </div>
          <p className="text-xs text-[var(--color-fg-subtle)] mb-4">Power off the node completely. Requires physical or IPMI access to bring it back online.</p>
          <button
            onClick={() => setPending('shutdown')}
            disabled={powerM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-err)]/10 hover:bg-[var(--color-err)]/20 text-[var(--color-err)] text-sm rounded-lg transition disabled:opacity-40"
          >
            {powerM.isPending && pending === 'shutdown' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <PowerOff className="w-4 h-4" />
            )}
            Shut Down Node
          </button>
        </div>
      </div>
    </>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/layout';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { formatUptime } from '@/lib/utils';
import { PowerOff, RotateCcw, Loader2, Clock } from 'lucide-react';

export default function PowerPage() {
  const { node } = useSystemNode();
  const [pending, setPending] = useState<'reboot' | 'shutdown' | null>(null);
  const [toast, setToast] = useState('');

  const { data: status } = useQuery({
    queryKey: ['node', node, 'status'],
    queryFn: () => api.nodes.status(node),
    enabled: !!node,
    refetchInterval: 10_000,
  });

  const powerM = useMutation({
    mutationFn: (command: 'reboot' | 'shutdown') => api.nodes.power(node, command),
    onSuccess: (_, command) => {
      setPending(null);
      setToast(`${command === 'reboot' ? 'Reboot' : 'Shutdown'} initiated for ${node}`);
      setTimeout(() => setToast(''), 5000);
    },
  });

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to manage power.
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 border border-gray-700 text-gray-200 text-sm px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

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

      <div>
        <h1 className="text-xl font-semibold text-white">Power</h1>
        <p className="text-sm text-gray-500">Reboot or shut down node {node}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-500" />
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Uptime</span>
          </div>
          <p className="text-lg font-mono text-white">
            {status ? formatUptime(status.uptime ?? 0) : '—'}
          </p>
          <p className="text-xs text-gray-600 mt-1">{status?.pveversion ?? ''}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <RotateCcw className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Reboot</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">Restart the node OS. VMs will be suspended or stopped depending on guest agent support.</p>
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

        <div className="bg-gray-900 border border-red-900/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <PowerOff className="w-4 h-4 text-red-400" />
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Shutdown</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">Power off the node completely. Requires physical or IPMI access to bring it back online.</p>
          <button
            onClick={() => setPending('shutdown')}
            disabled={powerM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-lg transition disabled:opacity-40"
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

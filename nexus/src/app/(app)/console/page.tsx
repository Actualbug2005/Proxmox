'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useClusterResources } from '@/hooks/use-cluster';
import { Terminal } from '@/components/console/terminal';
import { Server, Monitor, Box, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClusterResourcePublic } from '@/types/proxmox';

interface ConsoleTab {
  id: string;
  label: string;
  node: string;
  vmid?: number;
  type: 'qemu' | 'lxc' | 'node';
}

export default function ConsolePage() {
  const { data: resources } = useClusterResources();
  const [tabs, setTabs] = useState<ConsoleTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const searchParams = useSearchParams();

  useEffect(() => {
    const node = searchParams.get('node');
    const vmidStr = searchParams.get('vmid');
    const type = searchParams.get('type') as 'qemu' | 'lxc' | 'node' | null;
    if (!node || !type) return;
    const vmid = vmidStr ? parseInt(vmidStr, 10) : undefined;
    const id = type === 'node' ? `node/${node}` : `${type}/${node}/${vmid}`;
    setTabs((prev) => {
      if (prev.find((t) => t.id === id)) return prev;
      return [
        ...prev,
        { id, label: vmid ? `${type.toUpperCase()} ${vmid}` : node, node, vmid, type },
      ];
    });
    setActiveTab(id);
  }, [searchParams]);

  const nodes = resources?.filter((r) => r.type === 'node') ?? [];
  const vms = resources?.filter((r) => r.type === 'qemu') ?? [];
  const cts = resources?.filter((r) => r.type === 'lxc') ?? [];

  function openConsole(resource: ClusterResourcePublic) {
    const id = resource.id;
    if (tabs.find((t) => t.id === id)) {
      setActiveTab(id);
      return;
    }

    const tab: ConsoleTab = {
      id,
      label: resource.name ?? resource.id,
      node: resource.node ?? resource.id,
      vmid: resource.vmid,
      type: resource.type === 'qemu' ? 'qemu' : resource.type === 'lxc' ? 'lxc' : 'node',
    };

    setTabs((prev) => [...prev, tab]);
    setActiveTab(id);
  }

  function closeTab(id: string) {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    if (activeTab === id) {
      setActiveTab(tabs.find((t) => t.id !== id)?.id ?? null);
    }
  }

  const activeConsole = tabs.find((t) => t.id === activeTab);

  return (
    // Locked z-axis: the page owns its own fixed viewport slice so xterm's
    // internal scrollback never spills past the floating sidebar. The 32px
    // subtraction matches the master shell's py-4 (16px top + 16px bottom).
    <div className="flex h-[calc(100vh-32px)] overflow-hidden">
      {/* Resource picker — macro-container glass so it reads as part of
       *  the chrome environment, not a detached opaque panel. */}
      <div className="env-glass-card rounded-lg w-56 shrink-0 flex flex-col">
        <div className="px-4 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">Console</h2>
          <p className="text-xs text-zinc-500">Select a target</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
          {/* Nodes */}
          {nodes.length > 0 && (
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-widest px-2 mb-1">Nodes</p>
              {nodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openConsole(n)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition',
                    tabs.find((t) => t.id === n.id)
                      ? 'bg-orange-500/10 text-orange-400'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                  )}
                >
                  <Server className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{n.node ?? n.id}</span>
                </button>
              ))}
            </div>
          )}

          {/* VMs */}
          {vms.filter((v) => v.status === 'running').length > 0 && (
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-widest px-2 mb-1">VMs</p>
              {vms
                .filter((v) => v.status === 'running')
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => openConsole(v)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition',
                      tabs.find((t) => t.id === v.id)
                        ? 'bg-orange-500/10 text-orange-400'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                    )}
                  >
                    <Monitor className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {v.name ?? v.vmid}
                      <span className="text-zinc-600 text-xs ml-1">({v.vmid})</span>
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* Containers */}
          {cts.filter((c) => c.status === 'running').length > 0 && (
            <div>
              <p className="text-xs text-zinc-600 uppercase tracking-widest px-2 mb-1">
                Containers
              </p>
              {cts
                .filter((c) => c.status === 'running')
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openConsole(c)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition',
                      tabs.find((t) => t.id === c.id)
                        ? 'bg-orange-500/10 text-orange-400'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                    )}
                  >
                    <Box className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {c.name ?? c.vmid}
                      <span className="text-zinc-600 text-xs ml-1">({c.vmid})</span>
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Main console area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        {tabs.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-2 bg-zinc-900 border-b border-zinc-800/60 overflow-x-auto shrink-0">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer shrink-0 transition',
                  tab.id === activeTab
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.type === 'node' ? (
                  <Server className="w-3 h-3" />
                ) : tab.type === 'qemu' ? (
                  <Monitor className="w-3 h-3" />
                ) : (
                  <Box className="w-3 h-3" />
                )}
                <span>{tab.label}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="hover:text-red-400 transition ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Active terminal */}
        {activeConsole ? (
          <Terminal
            key={activeConsole.id}
            node={activeConsole.node}
            vmid={activeConsole.vmid}
            type={activeConsole.type}
            className="flex-1 rounded-none border-0"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-zinc-900 border border-zinc-800/60 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Plus className="w-5 h-5 text-zinc-600" />
              </div>
              <p className="text-sm text-zinc-500">Select a node, VM, or container</p>
              <p className="text-xs text-zinc-600 mt-1">from the panel on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

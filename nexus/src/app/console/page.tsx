'use client';

import { useState } from 'react';
import { useClusterResources } from '@/hooks/use-cluster';
import { Terminal } from '@/components/console/terminal';
import { Server, Monitor, Box, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClusterResource } from '@/types/proxmox';

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

  const nodes = resources?.filter((r) => r.type === 'node') ?? [];
  const vms = resources?.filter((r) => r.type === 'vm') ?? [];
  const cts = resources?.filter((r) => r.type === 'lxc') ?? [];

  function openConsole(resource: ClusterResource) {
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
      type: resource.type === 'vm' ? 'qemu' : resource.type === 'lxc' ? 'lxc' : 'node',
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
    <div className="flex h-screen">
      {/* Sidebar: resource picker */}
      <div className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">Console</h2>
          <p className="text-xs text-gray-500">Select a target</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
          {/* Nodes */}
          {nodes.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide px-2 mb-1">Nodes</p>
              {nodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openConsole(n)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition',
                    tabs.find((t) => t.id === n.id)
                      ? 'bg-orange-500/10 text-orange-400'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
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
              <p className="text-xs text-gray-600 uppercase tracking-wide px-2 mb-1">VMs</p>
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
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                    )}
                  >
                    <Monitor className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {v.name ?? v.vmid}
                      <span className="text-gray-600 text-xs ml-1">({v.vmid})</span>
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* Containers */}
          {cts.filter((c) => c.status === 'running').length > 0 && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide px-2 mb-1">
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
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                    )}
                  >
                    <Box className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {c.name ?? c.vmid}
                      <span className="text-gray-600 text-xs ml-1">({c.vmid})</span>
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
          <div className="flex items-center gap-1 px-3 py-2 bg-gray-900 border-b border-gray-800 overflow-x-auto shrink-0">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer shrink-0 transition',
                  tab.id === activeTab
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50',
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
              <div className="w-12 h-12 bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Plus className="w-5 h-5 text-gray-600" />
              </div>
              <p className="text-sm text-gray-500">Select a node, VM, or container</p>
              <p className="text-xs text-gray-600 mt-1">from the panel on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

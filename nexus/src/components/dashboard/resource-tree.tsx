'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Server,
  Monitor,
  Box,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn, cpuPercent, formatBytes } from '@/lib/utils';
import { StatusDot } from '@/components/ui/status-dot';
import type { ClusterResourcePublic } from '@/types/proxmox';

interface ResourceTreeProps {
  resources: ClusterResourcePublic[];
  onSelect?: (resource: ClusterResourcePublic) => void;
  selectedId?: string;
}

type GroupedResources = {
  [node: string]: {
    node?: ClusterResourcePublic;
    vms: ClusterResourcePublic[];
    containers: ClusterResourcePublic[];
  };
};

function ResourceRow({
  resource,
  selected,
  onSelect,
  indent = false,
}: {
  resource: ClusterResourcePublic;
  selected: boolean;
  onSelect?: (r: ClusterResourcePublic) => void;
  indent?: boolean;
}) {
  const Icon =
    resource.type === 'node' ? Server : resource.type === 'qemu' ? Monitor : Box;

  const cpu = cpuPercent(resource.cpu);
  // normalise node online/offline into StatusDot vocabulary
  const dotStatus =
    resource.status === 'online'
      ? 'running'
      : resource.status === 'offline'
        ? 'stopped'
        : resource.status;

  const inner = (
    <>
      <StatusDot status={dotStatus} size="sm" />
      <Icon className="w-3.5 h-3.5 shrink-0 text-zinc-500 group-hover:text-zinc-300" />
      <span className="flex-1 text-sm font-medium truncate text-zinc-200">
        {resource.name ?? resource.id}
        {resource.vmid ? (
          <span className="text-zinc-600 text-xs ml-1 tabular font-mono">({resource.vmid})</span>
        ) : null}
      </span>
      {resource.status === 'running' && resource.cpu !== undefined && (
        <span className="text-xs text-zinc-500 tabular font-mono">{cpu.toFixed(0)}%</span>
      )}
      {resource.status === 'running' && resource.mem !== undefined && resource.maxmem && (
        <span className="text-xs text-zinc-500 tabular font-mono">
          {formatBytes(resource.mem)}
        </span>
      )}
    </>
  );

  const cls = cn(
    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition group',
    indent && 'ml-5',
    selected ? 'bg-zinc-800 text-zinc-100' : 'hover:bg-zinc-800/50 text-zinc-300',
  );

  if (resource.type === 'qemu' && resource.node && resource.vmid) {
    return (
      <Link href={`/dashboard/vms/${resource.node}/${resource.vmid}`} className={cls}>
        {inner}
      </Link>
    );
  }
  if (resource.type === 'lxc' && resource.node && resource.vmid) {
    return (
      <Link href={`/dashboard/cts/${resource.node}/${resource.vmid}`} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={() => onSelect?.(resource)} className={cls}>
      {inner}
    </button>
  );
}

export function ResourceTree({ resources, onSelect, selectedId }: ResourceTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = resources.reduce<GroupedResources>((acc, r) => {
    if (r.type === 'node') {
      if (!acc[r.node ?? r.id]) acc[r.node ?? r.id] = { vms: [], containers: [] };
      acc[r.node ?? r.id].node = r;
    } else if (r.type === 'qemu') {
      const n = r.node ?? 'unknown';
      if (!acc[n]) acc[n] = { vms: [], containers: [] };
      acc[n].vms.push(r);
    } else if (r.type === 'lxc') {
      const n = r.node ?? 'unknown';
      if (!acc[n]) acc[n] = { vms: [], containers: [] };
      acc[n].containers.push(r);
    }
    return acc;
  }, {});

  function toggle(node: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(node)) next.delete(node);
      else next.add(node);
      return next;
    });
  }

  return (
    <div className="space-y-1">
      {Object.entries(grouped).map(([nodeName, group]) => {
        const isCollapsed = collapsed.has(nodeName);
        const nodeResource = group.node;
        const children = [...group.vms, ...group.containers];

        return (
          <div key={nodeName}>
            <div className="flex items-center">
              <button
                onClick={() => toggle(nodeName)}
                className="p-1 text-zinc-500 hover:text-zinc-300 transition"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              {nodeResource ? (
                <div className="flex-1">
                  <ResourceRow
                    resource={nodeResource}
                    selected={selectedId === nodeResource.id}
                    onSelect={onSelect}
                  />
                </div>
              ) : (
                <span className="flex-1 text-sm font-medium text-zinc-300 px-2 py-1">
                  {nodeName}
                </span>
              )}
            </div>

            {!isCollapsed && children.length > 0 && (
              <div className="ml-2 border-l border-zinc-800/60 pl-1 space-y-0.5 mt-0.5">
                {children.map((r) => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    selected={selectedId === r.id}
                    onSelect={onSelect}
                    indent
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

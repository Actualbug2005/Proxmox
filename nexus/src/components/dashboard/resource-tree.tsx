'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Server,
  Monitor,
  Box,
  ChevronDown,
  ChevronRight,
  Circle,
} from 'lucide-react';
import { cn, cpuPercent, formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
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

function statusVariant(status?: string): 'success' | 'danger' | 'warning' | 'outline' {
  switch (status) {
    case 'running':
    case 'online':
      return 'success';
    case 'stopped':
    case 'offline':
      return 'danger';
    case 'paused':
    case 'suspended':
      return 'warning';
    default:
      return 'outline';
  }
}

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

  const inner = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0 text-gray-500 group-hover:text-gray-400" />
      <span className="flex-1 text-sm truncate">
        {resource.name ?? resource.id}
        {resource.vmid && (
          <span className="text-gray-600 text-xs ml-1">({resource.vmid})</span>
        )}
      </span>
      {resource.status === 'running' && resource.cpu !== undefined && (
        <span className="text-xs text-gray-600 tabular-nums">{cpu.toFixed(0)}%</span>
      )}
      {resource.status === 'running' && resource.mem !== undefined && resource.maxmem && (
        <span className="text-xs text-gray-600 tabular-nums">
          {formatBytes(resource.mem)}
        </span>
      )}
      <Badge variant={statusVariant(resource.status)}>
        <Circle className="w-1.5 h-1.5 mr-1 fill-current" />
        {resource.status ?? 'unknown'}
      </Badge>
    </>
  );

  const cls = cn(
    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition group',
    indent && 'ml-5',
    selected ? 'bg-orange-500/10 text-orange-400' : 'hover:bg-gray-800 text-gray-300',
  );

  // VMs and CTs navigate to their detail pages; nodes stay as selectable buttons
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

  // Group by node
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
      next.has(node) ? next.delete(node) : next.add(node);
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
            {/* Node header */}
            <div className="flex items-center">
              <button
                onClick={() => toggle(nodeName)}
                className="p-1 text-gray-600 hover:text-gray-400 transition"
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
                <span className="flex-1 text-sm font-medium text-gray-400 px-2 py-1">
                  {nodeName}
                </span>
              )}
            </div>

            {/* Children */}
            {!isCollapsed && children.length > 0 && (
              <div className="ml-2 border-l border-gray-800 pl-1 space-y-0.5 mt-0.5">
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

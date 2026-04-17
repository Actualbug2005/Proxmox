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
import { Checkbox, type CheckboxState } from '@/components/ui/checkbox';
import type { ClusterResourcePublic } from '@/types/proxmox';

interface ResourceTreeProps {
  resources: ClusterResourcePublic[];
  onSelect?: (resource: ClusterResourcePublic) => void;
  selectedId?: string;
  /**
   * Additive multi-select for bulk lifecycle. When provided, a checkbox
   * column is rendered on guest rows (qemu/lxc) and a tri-state checkbox on
   * each node row that covers all guests under it. Single-select via
   * onSelect / selectedId is unaffected.
   */
  selectedIds?: Set<string>;
  onToggleSelected?: (resource: ClusterResourcePublic, next: boolean) => void;
  onToggleNodeGroup?: (guests: ClusterResourcePublic[], next: boolean) => void;
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
  leading,
}: {
  resource: ClusterResourcePublic;
  selected: boolean;
  onSelect?: (r: ClusterResourcePublic) => void;
  indent?: boolean;
  /** Optional cell rendered before the status dot (used for the multi-select checkbox). */
  leading?: React.ReactNode;
}) {
  const Icon =
    resource.type === 'node' ? Server : resource.type === 'qemu' ? Monitor : Box;

  const cpu = cpuPercent(resource.cpu);
  const dotStatus =
    resource.status === 'online'
      ? 'running'
      : resource.status === 'offline'
        ? 'stopped'
        : resource.status;

  const inner = (
    <>
      <StatusDot status={dotStatus} size="sm" />
      <Icon className="w-3.5 h-3.5 shrink-0 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-secondary)]" />
      <span className="flex-1 text-sm font-medium truncate text-[var(--color-fg-secondary)]">
        {resource.name ?? resource.id}
        {resource.vmid ? (
          <span className="text-[var(--color-fg-faint)] text-xs ml-1 tabular font-mono">({resource.vmid})</span>
        ) : null}
      </span>
      {resource.status === 'running' && resource.cpu !== undefined && (
        <span className="text-xs text-[var(--color-fg-subtle)] tabular font-mono">{cpu.toFixed(0)}%</span>
      )}
      {resource.status === 'running' && resource.mem !== undefined && resource.maxmem && (
        <span className="text-xs text-[var(--color-fg-subtle)] tabular font-mono">
          {formatBytes(resource.mem)}
        </span>
      )}
    </>
  );

  const linkCls = cn(
    'flex-1 flex items-center gap-2 px-2 py-2 rounded-lg text-left transition group min-w-0',
    selected ? 'bg-[var(--color-overlay)] text-[var(--color-fg)]' : 'hover:bg-zinc-800/50 text-[var(--color-fg-secondary)]',
  );

  const rowCls = cn(
    'w-full flex items-center gap-1.5',
    indent && 'ml-5',
  );

  let main: React.ReactNode;
  if (resource.type === 'qemu' && resource.node && resource.vmid) {
    main = (
      <Link href={`/dashboard/vms/${resource.node}/${resource.vmid}`} className={linkCls}>
        {inner}
      </Link>
    );
  } else if (resource.type === 'lxc' && resource.node && resource.vmid) {
    main = (
      <Link href={`/dashboard/cts/${resource.node}/${resource.vmid}`} className={linkCls}>
        {inner}
      </Link>
    );
  } else {
    main = (
      <button onClick={() => onSelect?.(resource)} className={linkCls}>
        {inner}
      </button>
    );
  }

  return (
    <div className={rowCls}>
      {leading}
      {main}
    </div>
  );
}

// Helper: compute the tri-state for a node's child checkbox.
function nodeGroupState(
  guests: ClusterResourcePublic[],
  selectedIds: Set<string>,
): CheckboxState {
  if (guests.length === 0) return false;
  const n = guests.filter((g) => selectedIds.has(g.id)).length;
  if (n === 0) return false;
  if (n === guests.length) return true;
  return 'indeterminate';
}

export function ResourceTree({
  resources,
  onSelect,
  selectedId,
  selectedIds,
  onToggleSelected,
  onToggleNodeGroup,
}: ResourceTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const multiSelect = selectedIds !== undefined && onToggleSelected !== undefined;

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
        const groupState = multiSelect ? nodeGroupState(children, selectedIds) : false;

        return (
          <div key={nodeName}>
            <div className="flex items-center">
              <button
                onClick={() => toggle(nodeName)}
                className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
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
                    leading={
                      multiSelect && children.length > 0 ? (
                        <Checkbox
                          checked={groupState}
                          onChange={(next) => onToggleNodeGroup?.(children, next)}
                          ariaLabel={`Select all guests on ${nodeName}`}
                        />
                      ) : null
                    }
                  />
                </div>
              ) : (
                <span className="flex-1 text-sm font-medium text-[var(--color-fg-secondary)] px-2 py-1">
                  {nodeName}
                </span>
              )}
            </div>

            {!isCollapsed && children.length > 0 && (
              <div className="ml-2 border-l border-[var(--color-border-subtle)] pl-1 space-y-0.5 mt-0.5">
                {children.map((r) => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    selected={selectedId === r.id}
                    onSelect={onSelect}
                    indent
                    leading={
                      multiSelect ? (
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onChange={(next) => onToggleSelected(r, next)}
                          ariaLabel={`Select ${r.name ?? r.id}`}
                          className="ml-5"
                        />
                      ) : null
                    }
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

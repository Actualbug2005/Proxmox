'use client';

/**
 * Renders a list of `ResourceGroup` rows produced by
 * `lib/resource-grouping`. The component itself is grouping-agnostic —
 * Flat / Nodes / Tags / Pools all collapse to the same shape.
 *
 * Multi-select is opt-in (selectedIds + onToggleSelected). When provided,
 * each guest row gets a checkbox and the group header shows a tri-state
 * checkbox covering its members.
 */
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
import {
  groupResources,
  parseTagList,
  type ViewMode,
  type ResourceGroup,
} from '@/lib/resource-grouping';

interface ResourceTreeProps {
  resources: ClusterResourcePublic[];
  /** Defaults to 'nodes' to match the legacy behaviour. */
  viewMode?: ViewMode;
  onSelect?: (resource: ClusterResourcePublic) => void;
  selectedId?: string;
  /**
   * Additive multi-select for bulk lifecycle. When provided, a checkbox
   * column is rendered on guest rows and a tri-state checkbox on each
   * group header. Single-select via onSelect / selectedId is unaffected.
   */
  selectedIds?: Set<string>;
  onToggleSelected?: (resource: ClusterResourcePublic, next: boolean) => void;
  onToggleGroup?: (members: ClusterResourcePublic[], next: boolean) => void;
}

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

  const tags = parseTagList(resource.tags);

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
      {tags.length > 0 && (
        <span className="hidden sm:flex items-center gap-1 shrink-0">
          {tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-overlay)] text-[var(--color-fg-muted)] uppercase tracking-wide"
              title={t}
            >
              {t}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-[10px] text-[var(--color-fg-faint)]">+{tags.length - 3}</span>
          )}
        </span>
      )}
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

function groupCheckboxState(
  members: ClusterResourcePublic[],
  selectedIds: Set<string>,
): CheckboxState {
  if (members.length === 0) return false;
  const n = members.filter((g) => selectedIds.has(g.id)).length;
  if (n === 0) return false;
  if (n === members.length) return true;
  return 'indeterminate';
}

export function ResourceTree({
  resources,
  viewMode = 'nodes',
  onSelect,
  selectedId,
  selectedIds,
  onToggleSelected,
  onToggleGroup,
}: ResourceTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const multiSelect = selectedIds !== undefined && onToggleSelected !== undefined;

  const groups: ResourceGroup[] = groupResources(resources, viewMode);

  function toggle(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  if (groups.length === 0) {
    return (
      <p className="text-sm text-[var(--color-fg-faint)] py-6 text-center">
        No guests to show.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        const groupState = multiSelect
          ? groupCheckboxState(group.members, selectedIds)
          : false;

        return (
          <div key={group.id}>
            <div className="flex items-center">
              <button
                onClick={() => toggle(group.id)}
                className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              {multiSelect && group.members.length > 0 && (
                <Checkbox
                  checked={groupState}
                  onChange={(next) => onToggleGroup?.(group.members, next)}
                  ariaLabel={`Select all in ${group.label}`}
                />
              )}
              <div className="flex-1 flex items-center gap-2 px-2 py-1 min-w-0">
                <span className="text-sm font-medium text-[var(--color-fg-secondary)] truncate">
                  {group.label}
                </span>
                {group.sublabel && (
                  <span className="text-xs text-[var(--color-fg-faint)] tabular font-mono">
                    {group.sublabel}
                  </span>
                )}
              </div>
            </div>

            {!isCollapsed && group.members.length > 0 && (
              <div className="ml-2 border-l border-[var(--color-border-subtle)] pl-1 space-y-0.5 mt-0.5">
                {group.members.map((r) => (
                  <ResourceRow
                    key={`${group.id}:${r.id}`}
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

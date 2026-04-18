'use client';

/**
 * Cluster-wide resource explorer with four grouping views.
 *
 * The per-type pages (/dashboard/vms, /dashboard/cts, /dashboard/nodes)
 * remain the place for detail / bulk lifecycle work. This page is the
 * "zoom out" view — see every guest in one tree, regroup by Tag or
 * Pool to find anything quickly.
 */
import { useState } from 'react';
import { Loader2, FolderTree } from 'lucide-react';
import { useClusterResources } from '@/hooks/use-cluster';
import { ResourceTree } from '@/components/dashboard/resource-tree';
import { Segmented } from '@/components/ui/segmented';
import type { ViewMode } from '@/lib/resource-grouping';

const VIEW_OPTIONS = [
  { value: 'flat',  label: 'Flat'  },
  { value: 'nodes', label: 'Nodes' },
  { value: 'tags',  label: 'Tags'  },
  { value: 'pools', label: 'Pools' },
] as const satisfies ReadonlyArray<{ value: ViewMode; label: string }>;

export default function ResourcesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('nodes');
  const { data: resources, isLoading } = useClusterResources();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-[var(--color-fg-muted)]" />
            Resources
          </h1>
          <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
            Cluster-wide guest tree. Switch the grouping to find guests by node,
            PVE tag, or resource pool.
          </p>
        </div>
        <Segmented
          value={viewMode}
          onChange={setViewMode}
          options={VIEW_OPTIONS}
          ariaLabel="Group resources by"
        />
      </header>

      <div className="studio-card p-3">
        {isLoading && (
          <div className="p-8 flex items-center justify-center text-[var(--color-fg-subtle)]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        {!isLoading && (
          <ResourceTree
            resources={resources ?? []}
            viewMode={viewMode}
          />
        )}
      </div>
    </div>
  );
}

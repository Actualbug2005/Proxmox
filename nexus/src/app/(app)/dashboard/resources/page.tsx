'use client';

/**
 * Cluster-wide resource explorer.
 *
 * Two orthogonal axes of filtering/grouping:
 *   - `?type=` narrows WHICH resources show (All / Nodes / VMs / CTs). URL-
 *     backed so deep-links from legacy /dashboard/{nodes,vms,cts} redirects
 *     and external bookmarks survive.
 *   - `viewMode` groups the remaining resources (flat / by node / by tag /
 *     by pool). Client-only for now — switches are ephemeral UX affordances.
 *
 * When view-mode is Pools, a "Manage pools" button opens PoolsModal
 * for pool CRUD. The dedicated /dashboard/cluster/pools route is
 * retired (redirects here).
 */
import { useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, FolderTree } from 'lucide-react';
import { useClusterResources } from '@/hooks/use-cluster';
import { ResourceTree } from '@/components/dashboard/resource-tree';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { PoolsModal } from '@/components/pools/pools-modal';
import { TYPE_IDS, filterByType, type TypeFilter } from '@/lib/resource-type-filter';
import type { ViewMode } from '@/lib/resource-grouping';

const VIEW_OPTIONS = [
  { value: 'flat',  label: 'Flat'  },
  { value: 'nodes', label: 'Nodes' },
  { value: 'tags',  label: 'Tags'  },
  { value: 'pools', label: 'Pools' },
] as const satisfies ReadonlyArray<{ value: ViewMode; label: string }>;

const TYPE_OPTIONS = [
  { value: 'all',   label: 'All'   },
  { value: 'nodes', label: 'Nodes' },
  { value: 'vms',   label: 'VMs'   },
  { value: 'cts',   label: 'CTs'   },
] as const satisfies ReadonlyArray<{ value: TypeFilter; label: string }>;

function isType(v: string | null): v is TypeFilter {
  return v !== null && (TYPE_IDS as readonly string[]).includes(v);
}

export default function ResourcesPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const rawType = sp.get('type');
  const typeFilter: TypeFilter = isType(rawType) ? rawType : 'all';

  const [viewMode, setViewMode] = useState<ViewMode>('nodes');
  const [poolsOpen, setPoolsOpen] = useState(false);

  const { data: resources, isLoading } = useClusterResources();

  const filtered = useMemo(
    () => (resources ? filterByType(resources, typeFilter) : []),
    [resources, typeFilter],
  );

  const setType = (id: TypeFilter) => {
    const next = new URLSearchParams(sp);
    if (id === 'all') next.delete('type');
    else next.set('type', id);
    const qs = next.toString();
    router.replace(qs ? `/dashboard/resources?${qs}` : '/dashboard/resources');
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-[var(--color-fg-muted)]" />
            Resources
          </h1>
          <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
            Cluster-wide resource tree. Filter by type, regroup by node, tag, or pool.
          </p>
        </div>
        {viewMode === 'pools' && (
          <Button variant="secondary" onClick={() => setPoolsOpen(true)}>
            Manage pools
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={typeFilter}
          onChange={setType}
          options={TYPE_OPTIONS}
          ariaLabel="Filter resources by type"
        />
        <Segmented
          value={viewMode}
          onChange={setViewMode}
          options={VIEW_OPTIONS}
          ariaLabel="Group resources by"
        />
      </div>

      <div className="studio-card p-3">
        {isLoading && (
          <div className="p-8 flex items-center justify-center text-[var(--color-fg-subtle)]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        {!isLoading && <ResourceTree resources={filtered} viewMode={viewMode} />}
      </div>

      <PoolsModal open={poolsOpen} onClose={() => setPoolsOpen(false)} />
    </div>
  );
}

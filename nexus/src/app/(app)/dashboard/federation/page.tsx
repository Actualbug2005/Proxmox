'use client';

/**
 * Federation registry dashboard.
 *
 * v0.34.0 lands registry + API proxy only. This page:
 *   - lists registered clusters with live probe status (30s poll)
 *   - renders an empty-state card when the registry is empty
 *   - offers Add / Rotate credentials / Remove via modal dialogs
 *
 * Federated resource-tree aggregation, cross-cluster console and
 * cross-cluster migration are separate Tier-6 features (see §6.2+).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Network, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readError } from '@/lib/create-csrf-mutation';
import { ClusterRow, type FederatedClusterView } from '@/components/federation/cluster-row';
import { AddClusterDialog } from '@/components/federation/add-cluster-dialog';
import { RotateCredentialsDialog } from '@/components/federation/rotate-credentials-dialog';
import { RemoveClusterDialog } from '@/components/federation/remove-cluster-dialog';

const POLL_MS = 30_000;
const QK_CLUSTERS = ['federation', 'clusters'] as const;

interface ClustersResponse {
  clusters: FederatedClusterView[];
}

export default function FederationPage() {
  const { data, isLoading, error } = useQuery<ClustersResponse, Error>({
    queryKey: QK_CLUSTERS,
    queryFn: async () => {
      const res = await fetch('/api/federation/clusters', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as ClustersResponse;
    },
    refetchInterval: POLL_MS,
  });

  const clusters = data?.clusters ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<FederatedClusterView | null>(null);
  const [removeTarget, setRemoveTarget] = useState<FederatedClusterView | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
            <Network className="w-5 h-5 text-[var(--color-fg-muted)]" />
            Federation
          </h1>
          <p className="text-sm text-[var(--color-fg-subtle)] mt-1 max-w-3xl">
            Register remote Proxmox VE clusters so this Nexus can act as a
            single pane of glass. Nexus stores the API token locally and
            proxies requests to the active endpoint of each registered
            cluster.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="shrink-0">
          <Plus className="w-4 h-4" />
          Add cluster
        </Button>
      </header>

      {isLoading && (
        <div className="studio-card p-10 flex items-center justify-center text-[var(--color-fg-subtle)]">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
      {error && (
        <div className="studio-card p-6 text-sm text-[var(--color-err)] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {!isLoading && !error && clusters.length === 0 && (
        <div className="studio-card p-10 text-center">
          <div className="w-12 h-12 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg flex items-center justify-center mb-4 mx-auto">
            <Network className="w-5 h-5 text-[var(--color-fg-subtle)]" />
          </div>
          <p className="text-sm font-medium text-[var(--color-fg-secondary)]">
            Federation registry is empty
          </p>
          <p className="text-xs text-[var(--color-fg-subtle)] mt-2 max-w-lg mx-auto leading-relaxed">
            Register remote PVE clusters to manage them from a single Nexus. This release
            (v0.34.0) lands the registry + API proxy rewrite. The resource tree will
            aggregate registered clusters in v0.35 (§6.2 Federated Resource Tree);
            cross-cluster console and migration land in later Tier 6 releases.
          </p>
          <div className="mt-5">
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" />
              Add cluster
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !error && clusters.length > 0 && (
        <section className="liquid-glass rounded-[20px] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Active endpoint</th>
                <th className="text-left px-4 py-2.5 font-medium">PVE version</th>
                <th className="text-right px-4 py-2.5 font-medium">Latency</th>
                <th className="text-left px-4 py-2.5 font-medium">Last probe</th>
                <th className="px-4 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((c) => (
                <ClusterRow
                  key={c.id}
                  cluster={c}
                  onRotate={() => setRotateTarget(c)}
                  onRemove={() => setRemoveTarget(c)}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {addOpen && <AddClusterDialog onClose={() => setAddOpen(false)} />}
      {rotateTarget && (
        <RotateCredentialsDialog
          cluster={rotateTarget}
          onClose={() => setRotateTarget(null)}
        />
      )}
      {removeTarget && (
        <RemoveClusterDialog
          cluster={removeTarget}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

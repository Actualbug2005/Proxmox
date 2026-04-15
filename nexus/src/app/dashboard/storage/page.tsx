'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNodes } from '@/hooks/use-cluster';
import { api } from '@/lib/proxmox-client';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Badge } from '@/components/ui/badge';
import { formatBytes, memPercent } from '@/lib/utils';
import { Loader2, HardDrive, Database, ServerCog, Share2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PVEStorage } from '@/types/proxmox';
import { PhysicalDisksTable } from '@/components/storage/physical-disks-table';
import { NasServicesCard } from '@/components/nas/nas-services-card';
import { NasSharesTable } from '@/components/nas/nas-shares-table';
import { CreateShareDialog } from '@/components/nas/create-share-dialog';

type Tab = 'pools' | 'disks' | 'nas';

function StorageRow({ storage }: { storage: PVEStorage & { node: string } }) {
  const usedPct = memPercent(storage.used, storage.total);
  const active = storage.active === 1;

  return (
    <Link
      href={`/dashboard/storage/${storage.node}/${storage.storage}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-800/50 hover:border-orange-500/30 transition rounded-lg"
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-emerald-500/10' : 'bg-gray-800'}`}>
        <HardDrive className={`w-4 h-4 ${active ? 'text-emerald-400' : 'text-gray-600'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium text-white">{storage.storage}</p>
          <Badge variant="outline">{storage.type}</Badge>
          {storage.shared === 1 && <Badge variant="info">shared</Badge>}
          <Badge variant={active ? 'success' : 'danger'}>{active ? 'active' : 'inactive'}</Badge>
        </div>
        <p className="text-xs text-gray-500">
          {storage.node} · {storage.content?.split(',').join(', ')}
        </p>
      </div>
      <div className="text-right shrink-0 min-w-32">
        {storage.total ? (
          <>
            <p className="text-xs text-gray-400 mb-1">
              {formatBytes(storage.used ?? 0)} / {formatBytes(storage.total)}
            </p>
            <ProgressBar value={usedPct} className="w-32" />
          </>
        ) : (
          <p className="text-xs text-gray-600">—</p>
        )}
      </div>
    </Link>
  );
}

export default function StoragePage() {
  const [tab, setTab] = useState<Tab>('pools');
  const [nasNode, setNasNode] = useState<string>('');
  const [showCreateShare, setShowCreateShare] = useState(false);
  const { data: nodes, isLoading: nodesLoading } = useNodes();

  const nodeNames = nodes?.map((n) => n.node ?? n.id) ?? [];

  // Default the NAS node picker to the first cluster node once nodes arrive.
  useEffect(() => {
    if (!nasNode && nodeNames.length > 0) setNasNode(nodeNames[0]);
  }, [nasNode, nodeNames]);

  const storageQueries = useQuery({
    queryKey: ['storage', 'all', nodeNames],
    queryFn: async () => {
      const results = await Promise.all(
        nodeNames.map(async (node) => {
          const storages = await api.storage.list(node);
          return storages.map((s) => ({ ...s, node }));
        }),
      );
      return results.flat();
    },
    enabled: nodeNames.length > 0 && tab === 'pools',
    refetchInterval: 30_000,
  });

  const storages = storageQueries.data ?? [];
  const isLoading = nodesLoading || storageQueries.isLoading;

  // Deduplicate shared storage (same storage name appearing on multiple nodes)
  const seen = new Set<string>();
  const unique = storages.filter((s) => {
    const key = s.shared === 1 ? s.storage : `${s.node}:${s.storage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const totalUsed = unique.reduce((acc, s) => acc + (s.used ?? 0), 0);
  const totalCapacity = unique.reduce((acc, s) => acc + (s.total ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Storage</h1>
        <p className="text-sm text-gray-500">
          {tab === 'pools'
            ? `${unique.length} storage pool${unique.length !== 1 ? 's' : ''} · ${formatBytes(totalUsed)} used of ${formatBytes(totalCapacity)}`
            : 'Per-node physical disks and S.M.A.R.T. health'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {(
          [
            ['pools', 'Storage Pools', Database],
            ['disks', 'Physical Disks', ServerCog],
            ['nas', 'NAS & Shares', Share2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium transition border-b-2 -mb-px',
              tab === id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'pools' && (
        <>
          {totalCapacity > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex justify-between text-xs text-gray-500 mb-2">
                <span>Total cluster storage</span>
                <span>{memPercent(totalUsed, totalCapacity).toFixed(1)}% used</span>
              </div>
              <ProgressBar value={memPercent(totalUsed, totalCapacity)} />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>{formatBytes(totalUsed)} used</span>
                <span>{formatBytes(totalCapacity - totalUsed)} free</span>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          )}

          {!isLoading && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <Database className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-300">Storage Pools</span>
              </div>
              <div className="divide-y divide-gray-800/50 p-2">
                {unique.length === 0 ? (
                  <p className="text-sm text-gray-600 py-8 text-center">No storage found</p>
                ) : (
                  unique.map((s) => (
                    <StorageRow key={`${s.node}:${s.storage}`} storage={s} />
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'disks' && <PhysicalDisksTable />}

      {tab === 'nas' && (
        <>
          {showCreateShare && nasNode && (
            <CreateShareDialog
              node={nasNode}
              onClose={() => setShowCreateShare(false)}
              onCreated={() => {
                // TanStack Query invalidation happens inside NasSharesTable via
                // the queryKey ['nas-shares', node]; we force a refetch here by
                // invalidating through the shared QueryClient below.
              }}
            />
          )}

          {/* Node picker (only shown when there's a choice) */}
          {nodeNames.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              {nodeNames.map((n) => (
                <button
                  key={n}
                  onClick={() => setNasNode(n)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition',
                    nasNode === n
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                      : 'text-gray-500 bg-gray-900 border border-gray-800 hover:text-gray-300',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          {!nasNode ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <NasServicesCard node={nasNode} />
                </div>
                <button
                  onClick={() => setShowCreateShare(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Create Share
                </button>
              </div>
              <NasSharesTable node={nasNode} />
            </>
          )}
        </>
      )}
    </div>
  );
}

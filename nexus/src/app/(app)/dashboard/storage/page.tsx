'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNodes, POLL_INTERVALS } from '@/hooks/use-cluster';
import { api } from '@/lib/proxmox-client';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Gauge } from '@/components/ui/gauge';
import { StatusDot } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { formatBytes, memPercent } from '@/lib/utils';
import { Loader2, HardDrive, Database, ServerCog, Share2, Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PVEStoragePublic, PVEStorageConfigPublic } from '@/types/proxmox';
import { PhysicalDisksTable } from '@/components/storage/physical-disks-table';
import { MapStorageDialog } from '@/components/storage/map-storage-dialog';
import { NasServicesCard } from '@/components/nas/nas-services-card';
import { NasSharesTable } from '@/components/nas/nas-shares-table';
import { CreateShareDialog } from '@/components/nas/create-share-dialog';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { useToast } from '@/components/ui/toast';

type Tab = 'pools' | 'disks' | 'nas';

function StorageRow({
  storage,
  onEdit,
  onDelete,
  editLoading,
}: {
  storage: PVEStoragePublic & { node: string };
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  editLoading: boolean;
}) {
  const usedPct = memPercent(storage.used, storage.total);
  const active = storage.active ?? false;

  return (
    <Link
      href={`/dashboard/storage/${storage.node}/${storage.storage}`}
      className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-800/40 transition rounded-lg"
    >
      <div className={cn(
        'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ring-1 ring-inset',
        active ? 'bg-[var(--color-ok)]/10 ring-[var(--color-ok)]/20' : 'bg-zinc-800/60 ring-white/5',
      )}>
        <HardDrive className={cn('w-3.5 h-3.5', active ? 'text-[var(--color-ok)]' : 'text-[var(--color-fg-faint)]')} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <StatusDot status={active ? 'running' : 'stopped'} size="sm" aria-label={active ? 'active' : 'inactive'} />
          <p className="text-data font-medium text-[var(--color-fg)]">{storage.storage}</p>
          <Badge variant="outline">{storage.type}</Badge>
          {(storage.shared ?? false) && <Badge variant="info">shared</Badge>}
        </div>
        <p className="text-xs text-[var(--color-fg-subtle)]">
          {storage.node} · {storage.content?.split(',').join(', ')}
        </p>
      </div>
      <div className="text-right shrink-0 min-w-32">
        {storage.total ? (
          <div className="flex flex-col gap-1 items-end">
            <p className="text-data tabular font-mono text-[var(--color-fg-secondary)]">
              {formatBytes(storage.used ?? 0)} <span className="text-[var(--color-fg-faint)]">/</span> {formatBytes(storage.total)}
            </p>
            <Gauge value={usedPct} className="w-28" label={`${storage.storage} usage`} />
          </div>
        ) : (
          <p className="text-xs text-[var(--color-fg-faint)]">—</p>
        )}
      </div>
      {/* Actions — stopPropagation+preventDefault so the parent <Link> doesn't
          fire and navigate to the detail page when the user clicks a button. */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit(storage.storage);
          }}
          disabled={editLoading}
          className="p-1.5 rounded-lg text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-white/5 transition disabled:opacity-50 disabled:cursor-wait"
          aria-label={`Edit ${storage.storage}`}
          title="Edit storage"
        >
          {editLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Pencil className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(storage.storage);
          }}
          className="p-1.5 rounded-lg text-[var(--color-fg-subtle)] hover:text-[var(--color-err)] hover:bg-white/5 transition"
          aria-label={`Delete ${storage.storage}`}
          title="Delete storage"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </Link>
  );
}

export default function StoragePage() {
  const [tab, setTab] = useState<Tab>('pools');
  const [nasNode, setNasNode] = useState<string>('');
  const [showCreateShare, setShowCreateShare] = useState(false);
  const [showMapStorage, setShowMapStorage] = useState(false);
  const [editTarget, setEditTarget] = useState<PVEStorageConfigPublic | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { data: nodes, isLoading: nodesLoading } = useNodes();

  const nodeNames = useMemo(
    () => nodes?.map((n) => n.node ?? n.id ?? '') ?? [],
    [nodes],
  );

  // Fetch full config for the row the user clicked Edit on, then open the
  // dialog once the config lands. PVE's per-node list endpoint lacks the
  // topology fields (server/export/path/…) so we can't prefill without this.
  async function handleEdit(id: string) {
    setEditLoadingId(id);
    try {
      const cfg = await api.storage.get(id);
      setEditTarget(cfg);
    } catch (err) {
      toast.error('Could not load storage', err instanceof Error ? err.message : String(err));
    } finally {
      setEditLoadingId(null);
    }
  }

  const deleteM = useMutation({
    mutationFn: (id: string) => api.storage.delete(id),
    onSuccess: (_data, id) => {
      toast.success('Storage detached', id);
      setDeleteTargetId(null);
      qc.invalidateQueries({ queryKey: ['storage'] });
    },
    onError: (err) => {
      toast.error('Delete failed', err instanceof Error ? err.message : String(err));
    },
  });

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
    refetchInterval: POLL_INTERVALS.config,
  });

  const storages = storageQueries.data ?? [];
  const isLoading = nodesLoading || storageQueries.isLoading;

  // Deduplicate shared storage (same storage name appearing on multiple nodes)
  const seen = new Set<string>();
  const unique = storages.filter((s) => {
    const key = (s.shared ?? false) ? s.storage : `${s.node}:${s.storage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const totalUsed = unique.reduce((acc, s) => acc + (s.used ?? 0), 0);
  const totalCapacity = unique.reduce((acc, s) => acc + (s.total ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-fg)]">Storage</h1>
        <p className="text-sm text-[var(--color-fg-subtle)] tabular">
          {tab === 'pools'
            ? `${unique.length} storage pool${unique.length !== 1 ? 's' : ''} · ${formatBytes(totalUsed)} used of ${formatBytes(totalCapacity)}`
            : 'Per-node physical disks and S.M.A.R.T. health'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
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
                ? 'border-zinc-200 text-indigo-400'
                : 'border-transparent text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {showMapStorage && (
        <MapStorageDialog
          nodeNames={nodeNames}
          onClose={() => setShowMapStorage(false)}
          onMapped={() => {
            // Close + force a refetch of every node's storage list so the
            // new pool shows up in the table without waiting for the 30s
            // polling tick. Invalidating the root queryKey matches both
            // ['storage','all',nodeNames] *and* any descendent keys we
            // might add later.
            setShowMapStorage(false);
            qc.invalidateQueries({ queryKey: ['storage'] });
          }}
        />
      )}

      {editTarget && (
        <MapStorageDialog
          nodeNames={nodeNames}
          existingStorage={editTarget}
          onClose={() => setEditTarget(null)}
          onMapped={() => {
            setEditTarget(null);
            qc.invalidateQueries({ queryKey: ['storage'] });
          }}
        />
      )}

      {deleteTargetId && (
        <ConfirmDialog
          title={`Delete storage "${deleteTargetId}"?`}
          message="Data on the underlying share will not be destroyed, but the storage will be detached from the Proxmox cluster."
          danger
          onCancel={() => setDeleteTargetId(null)}
          onConfirm={() => deleteM.mutate(deleteTargetId)}
        />
      )}

      {tab === 'pools' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowMapStorage(true)}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              Map Storage
            </button>
          </div>

          {totalCapacity > 0 && (
            <div className="studio-card p-4">
              <div className="flex justify-between text-xs text-[var(--color-fg-subtle)] mb-2">
                <span className="uppercase tracking-[0.1em] font-semibold text-[11px]">Total cluster storage</span>
                <span className="tabular font-mono text-data text-[var(--color-fg-secondary)]">{memPercent(totalUsed, totalCapacity).toFixed(1)}% used</span>
              </div>
              <ProgressBar value={memPercent(totalUsed, totalCapacity)} />
              <div className="flex justify-between text-xs text-[var(--color-fg-subtle)] mt-2 tabular font-mono">
                <span>{formatBytes(totalUsed)} used</span>
                <span>{formatBytes(totalCapacity - totalUsed)} free</span>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--color-fg-muted)]" />
            </div>
          )}

          {!isLoading && (
            <div className="studio-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--color-border-subtle)] flex items-center gap-2">
                <Database className="w-4 h-4 text-[var(--color-fg-subtle)]" />
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">Storage Pools</span>
              </div>
              <div className="divide-y divide-zinc-800/60 p-2">
                {unique.length === 0 ? (
                  <p className="text-sm text-[var(--color-fg-faint)] py-8 text-center">No storage found</p>
                ) : (
                  unique.map((s) => (
                    <StorageRow
                      key={`${s.node}:${s.storage}`}
                      storage={s}
                      onEdit={handleEdit}
                      onDelete={setDeleteTargetId}
                      editLoading={editLoadingId === s.storage}
                    />
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
                // Force an immediate refetch instead of waiting up to 30s for
                // the NasSharesTable's polling interval — the new row should
                // appear the moment the dialog closes.
                qc.invalidateQueries({ queryKey: ['nas-shares', nasNode] });
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
                      ? 'bg-white/10 text-indigo-300 ring-1 ring-inset ring-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                      : 'text-[var(--color-fg-subtle)] bg-[var(--color-surface)] ring-1 ring-inset ring-white/[0.06] hover:text-[var(--color-fg-secondary)] hover:bg-zinc-800/40',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          {!nasNode ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <NasServicesCard node={nasNode} />
                </div>
                <button
                  onClick={() => setShowCreateShare(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition shrink-0"
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

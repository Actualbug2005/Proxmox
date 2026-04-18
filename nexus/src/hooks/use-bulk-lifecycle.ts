/**
 * React Query hooks for /api/cluster/bulk-lifecycle.
 *
 * Shapes mirror use-script-jobs.ts so query-key prefixes, CSRF header
 * plumbing, and adaptive polling stay consistent across the two
 * fire-and-forget systems.
 */

import { useQuery } from '@tanstack/react-query';
import { useCsrfMutation, readError } from '@/lib/create-csrf-mutation';
import type { BulkBatchDto } from '@/app/api/cluster/bulk-lifecycle/route';
import type { BulkOp, GuestType, SnapshotParams } from '@/lib/bulk-ops';

export type { BulkBatchDto, BulkOp, GuestType, SnapshotParams };

export interface BulkLifecycleTarget {
  guestType: GuestType;
  node: string;
  vmid: number;
  /** Display name at enqueue time — the server stores it so the UI can
   *  render even if the resource disappears from the cluster-resources cache. */
  name?: string;
}

export interface StartBulkOpInput {
  op: BulkOp;
  targets: BulkLifecycleTarget[];
  snapshot?: SnapshotParams;
  maxConcurrent?: number;
}

export interface StartBulkOpResponse {
  batchId: string;
  itemCount: number;
  batch: BulkBatchDto;
}

const LIST_KEY = ['bulk-lifecycle', 'list'] as const;
const detailKey = (id: string) => ['bulk-lifecycle', 'detail', id] as const;

function anyNonTerminal(batches: BulkBatchDto[]): boolean {
  return batches.some(
    (b) => !b.finishedAt || b.items.some((i) => i.status === 'pending' || i.status === 'running'),
  );
}

/**
 * Recent batches for the signed-in user. Adaptive polling — 2s while any
 * batch has non-terminal items, 30s otherwise. Matches useScriptJobs'
 * cadence so the UI stays responsive while active work runs without
 * burning cycles when everything's settled.
 */
export function useBulkBatches() {
  return useQuery<{ batches: BulkBatchDto[] }, Error>({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const res = await fetch('/api/cluster/bulk-lifecycle');
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { batches: BulkBatchDto[] };
    },
    refetchInterval: (query) => {
      const batches = query.state.data?.batches ?? [];
      return anyNonTerminal(batches) ? 2_000 : 30_000;
    },
    staleTime: 1_000,
  });
}

export function useBulkBatch(id: string | null) {
  return useQuery<{ batch: BulkBatchDto }, Error>({
    queryKey: detailKey(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/cluster/bulk-lifecycle/${encodeURIComponent(id!)}`);
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { batch: BulkBatchDto };
    },
    refetchInterval: (query) => {
      const b = query.state.data?.batch;
      if (!b) return 2_000;
      return anyNonTerminal([b]) ? 2_000 : false;
    },
  });
}

export function useStartBulkOp() {
  return useCsrfMutation<StartBulkOpResponse, StartBulkOpInput>({
    url: '/api/cluster/bulk-lifecycle',
    method: 'POST',
    invalidateKeys: [[...LIST_KEY]],
  });
}

export function useCancelBulkOp() {
  return useCsrfMutation<{ batch: BulkBatchDto | null }, string>({
    url: (id) => `/api/cluster/bulk-lifecycle/${encodeURIComponent(id)}`,
    method: 'DELETE',
    invalidateKeys: (_data, id) => [[...LIST_KEY], [...detailKey(id)]],
  });
}

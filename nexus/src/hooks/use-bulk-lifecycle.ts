/**
 * React Query hooks for /api/cluster/bulk-lifecycle.
 *
 * Shapes mirror use-script-jobs.ts so query-key prefixes, CSRF header
 * plumbing, and adaptive polling stay consistent across the two
 * fire-and-forget systems.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { readCsrfCookie } from '@/lib/proxmox-client';
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

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

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
  const qc = useQueryClient();
  return useMutation<StartBulkOpResponse, Error, StartBulkOpInput>({
    mutationFn: async (input) => {
      const csrf = readCsrfCookie();
      const res = await fetch('/api/cluster/bulk-lifecycle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as StartBulkOpResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useCancelBulkOp() {
  const qc = useQueryClient();
  return useMutation<{ batch: BulkBatchDto | null }, Error, string>({
    mutationFn: async (id) => {
      const csrf = readCsrfCookie();
      const res = await fetch(`/api/cluster/bulk-lifecycle/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}) },
      });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { batch: BulkBatchDto | null };
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: detailKey(id) });
    },
  });
}

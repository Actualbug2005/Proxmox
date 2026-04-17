/**
 * React Query hooks for the Intelligent Migration Wizard.
 *
 * Three layered hooks:
 *   - useMigratePrecondition(guestType, node, vmid)
 *     Single query against PVE's GET /migrate endpoint. Stable within a
 *     wizard session, so staleTime is generous and refetchInterval is
 *     disabled.
 *   - useCandidateTargets({ guestType, node, vmid, ask })
 *     Composes cluster.resources (for the live cpu/mem snapshot), per-node
 *     status (for loadavg), and the precondition, then runs scoreTargets()
 *     to produce the ranked list the wizard renders.
 *   - useMigrateGuest()
 *     Mutation that dispatches to api.vms.migrate or api.containers.migrate
 *     based on guestType. Invalidates cluster + tasks on success so the
 *     existing task-list re-picks the fresh UPID.
 */

import { useMemo } from 'react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { readCsrfCookie } from '@/lib/proxmox-client';
import {
  scoreTargets,
  type GuestResourceAsk,
  type NodeSnapshot,
  type ScoredTarget,
} from '@/lib/migration-score';
import type {
  MigrateCTParamsPublic,
  MigratePrecondition,
  MigrateVMParamsPublic,
  NodeStatus,
} from '@/types/proxmox';
import { useClusterResources } from '@/hooks/use-cluster';

export type GuestType = 'qemu' | 'lxc';

// ─── Precondition query ─────────────────────────────────────────────────────

export function useMigratePrecondition(
  guestType: GuestType | null,
  node: string | null,
  vmid: number | null,
) {
  return useQuery<MigratePrecondition, Error>({
    queryKey: ['migrate-precondition', guestType, node, vmid],
    enabled: !!guestType && !!node && !!vmid,
    queryFn: () =>
      guestType === 'qemu'
        ? api.vms.migratePrecondition(node!, vmid!)
        : api.containers.migratePrecondition(node!, vmid!),
    // Preconditions don't change fast within a wizard session; don't poll.
    staleTime: 10_000,
    refetchInterval: false,
    retry: 1,
  });
}

// ─── Candidate target list ──────────────────────────────────────────────────

export interface CandidateTargetsResult {
  scored: ScoredTarget[];
  loading: boolean;
  error: Error | null;
}

interface CandidateTargetsInput {
  guestType: GuestType;
  sourceNode: string;
  vmid: number;
  ask: GuestResourceAsk | null;
}

/**
 * Parse NodeStatus.loadavg (tuple of strings like ["0.42","0.51","0.48"])
 * into a numeric 1-minute load. Missing or malformed → undefined so the
 * scorer simply skips the loadavg penalty.
 */
function parseLoadavg1(s: NodeStatus | undefined): number | undefined {
  const raw = s?.loadavg?.[0];
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function useCandidateTargets({
  guestType,
  sourceNode,
  vmid,
  ask,
}: CandidateTargetsInput): CandidateTargetsResult {
  const precondition = useMigratePrecondition(guestType, sourceNode, vmid);
  const { data: resources, isLoading: resourcesLoading, error: resourcesError } =
    useClusterResources();

  // Cluster nodes only — the scorer is guest-agnostic; it just needs the
  // node pressure snapshot.
  const nodeRows = useMemo(
    () => (resources ?? []).filter((r) => r.type === 'node'),
    [resources],
  );

  // Parallel-fetch per-node status so scoring has loadavg even when the
  // cluster-resources endpoint doesn't carry it. `enabled` is gated on
  // the node being online to avoid a burst of 5xx's against offline peers.
  const statusQueries = useQueries({
    queries: nodeRows.map((n) => ({
      queryKey: ['node', n.node ?? n.id, 'status'],
      queryFn: () => api.nodes.status(n.node ?? n.id),
      enabled: n.status === 'online',
      // Inherit the standard status cadence; don't duplicate the poll
      // interval definition here — use-cluster.ts already owns it.
      staleTime: 5_000,
      retry: 1,
    })),
  });

  const scored = useMemo<ScoredTarget[]>(() => {
    if (!ask || !resources) return [];
    const snapshots: NodeSnapshot[] = nodeRows.map((n, i) => {
      const statusData = statusQueries[i]?.data as NodeStatus | undefined;
      const name = n.node ?? n.id;
      return {
        name,
        online: n.status === 'online',
        maxCores: n.maxcpu ?? 0,
        cpu: n.cpu ?? 0,
        maxMemory: n.maxmem ?? 0,
        memory: n.mem ?? 0,
        loadavg1: parseLoadavg1(statusData),
      };
    });

    // PVE's precondition may or may not carry allowed/not_allowed. Scorer
    // tolerates both being absent.
    const allowed =
      precondition.data?.allowed_nodes && precondition.data.allowed_nodes.length > 0
        ? new Set(precondition.data.allowed_nodes)
        : undefined;
    const notAllowed = new Map<string, string>();
    for (const row of precondition.data?.not_allowed_nodes ?? []) {
      if (row.node) notAllowed.set(row.node, row.reason ?? 'not allowed');
    }

    return scoreTargets(ask, snapshots, allowed, notAllowed);
  }, [ask, resources, nodeRows, statusQueries, precondition.data]);

  const loading = resourcesLoading || precondition.isLoading;
  const error = (resourcesError as Error | null) ?? precondition.error ?? null;
  return { scored, loading, error };
}

// ─── Migrate mutation ───────────────────────────────────────────────────────

export interface MigrateInput {
  guestType: GuestType;
  sourceNode: string;
  vmid: number;
  target: string;
  /** QEMU: live-migrate if running; LXC: ignored (use `restart` instead). */
  online?: boolean;
  /** LXC only: shutdown + migrate + restart. */
  restart?: boolean;
  /** QEMU only: move local disks too. */
  withLocalDisks?: boolean;
}

export interface MigrateResponse {
  /** PVE task UPID. */
  upid: string;
  sourceNode: string;
}

export function useMigrateGuest() {
  const qc = useQueryClient();
  return useMutation<MigrateResponse, Error, MigrateInput>({
    mutationFn: async (input) => {
      // Using the browser-side api wrapper which threads through
      // /api/proxmox/... with CSRF + ticket headers. Read CSRF defensively
      // — the wrapper reads it too, but older callers sometimes needed
      // to set it explicitly.
      readCsrfCookie();

      let upid: string;
      if (input.guestType === 'qemu') {
        const params: MigrateVMParamsPublic = { target: input.target };
        if (input.online !== undefined) params.online = input.online;
        if (input.withLocalDisks !== undefined) params.with_local_disks = input.withLocalDisks;
        upid = await api.vms.migrate(input.sourceNode, input.vmid, params);
      } else {
        const params: MigrateCTParamsPublic = { target: input.target };
        if (input.restart !== undefined) params.restart = input.restart;
        if (input.online !== undefined) params.online = input.online;
        upid = await api.containers.migrate(input.sourceNode, input.vmid, params);
      }
      return { upid, sourceNode: input.sourceNode };
    },
    onSuccess: (_data, input) => {
      // Everything might have moved — invalidate broadly. The existing
      // per-guest pages refetch on navigation so no detail-key poke needed.
      void qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
      void qc.invalidateQueries({ queryKey: ['cluster', 'tasks'] });
      void qc.invalidateQueries({ queryKey: ['cluster', 'status'] });
      const key =
        input.guestType === 'qemu'
          ? ['vm', input.sourceNode, input.vmid]
          : ['ct', input.sourceNode, input.vmid];
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

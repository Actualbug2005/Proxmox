'use client';

/**
 * On-demand guest-agent probe hook. Kept separate from the disk-pressure
 * widget's aggregate query so a drawer or inspector can refresh a single
 * guest without re-pulling the cluster roll-up.
 *
 * No automatic polling — probing a live agent puts load on the guest
 * (qemu-guest-agent RPCs traverse the host/guest ring buffer). Refetch
 * is operator-driven; the cluster-wide poll source runs on the server.
 */
import { useQuery } from '@tanstack/react-query';
import { readError } from '@/lib/create-csrf-mutation';
import type { DiskPressure, GuestProbe } from '@/lib/guest-agent/types';

export function useGuestAgent(node: string | undefined, vmid: number | undefined) {
  return useQuery<GuestProbe, Error>({
    queryKey: ['guest-agent', node, vmid] as const,
    enabled: Boolean(node && vmid),
    queryFn: async () => {
      const res = await fetch(
        `/api/guests/${encodeURIComponent(node!)}/${vmid}/agent`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as GuestProbe;
    },
    // Operator-triggered — never auto-refetch, never refetch on focus.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export interface GuestPressureResponse {
  updatedAt: number;
  pressures: DiskPressure[];
  unreachable: Array<{ vmid: number; node: string; reason: string }>;
}

/**
 * Cluster-wide guest disk-pressure roll-up (read-only snapshot).
 * 30s cadence matches the notifications-recent panel — these feeds
 * share an ops-dashboard context.
 */
export function useGuestPressure() {
  return useQuery<GuestPressureResponse, Error>({
    queryKey: ['guest-pressure'] as const,
    queryFn: async () => {
      const res = await fetch('/api/guests/pressure', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as GuestPressureResponse;
    },
    refetchInterval: 30_000,
  });
}

'use client';

/**
 * Thin TanStack Query + CSRF hooks for the Auto-DRS state.
 *
 * Two reads (policy + history) + one mutation (policy PATCH).
 * Recent-history poll cadence matches the notifications-recent panel
 * (30 s) since both feed similar ops-dashboards.
 */
import { useQuery } from '@tanstack/react-query';
import { readError, useCsrfMutation } from '@/lib/create-csrf-mutation';
import type { DrsHistoryEntry, DrsPolicy } from '@/lib/drs/types';

const POLL_MS = 30_000;

const QK = {
  state:   ['drs', 'state'] as const,
  history: ['drs', 'history'] as const,
};

export interface DrsStateResponse {
  policy: DrsPolicy;
  history: DrsHistoryEntry[];
}

export function useDrsState() {
  return useQuery<DrsStateResponse, Error>({
    queryKey: QK.state,
    queryFn: async () => {
      const res = await fetch('/api/cluster/drs', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as DrsStateResponse;
    },
    refetchInterval: POLL_MS,
  });
}

export function useDrsHistory(limit = 50) {
  return useQuery<DrsHistoryEntry[], Error>({
    queryKey: [...QK.history, limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/cluster/drs/log?limit=${limit}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { history: DrsHistoryEntry[] };
      return body.history;
    },
    refetchInterval: POLL_MS,
  });
}

export function useUpdateDrsPolicy() {
  return useCsrfMutation<{ policy: DrsPolicy }, Partial<DrsPolicy>>({
    url: '/api/cluster/drs',
    method: 'PATCH',
    invalidateKeys: [[...QK.state], [...QK.history]],
  });
}

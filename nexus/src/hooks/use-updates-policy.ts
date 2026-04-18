'use client';

/**
 * Auto-update policy + history hooks. Reads are cheap; writes go
 * through the CSRF mutation helper and invalidate the policy key.
 */
import { useQuery } from '@tanstack/react-query';
import { readError, useCsrfMutation } from '@/lib/create-csrf-mutation';
import type { UpdatePolicy } from '@/lib/updates/types';
import type { RunHistoryEntry } from '@/lib/run-history/store';

const QK_POLICY = ['updates', 'policy'] as const;
const QK_HISTORY = ['updates', 'history'] as const;

export function useUpdatesPolicy() {
  return useQuery<UpdatePolicy, Error>({
    queryKey: QK_POLICY,
    queryFn: async () => {
      const res = await fetch('/api/system/updates-policy', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as UpdatePolicy;
    },
    // 30s matches the notifications-recent panel — ops-dashboard tier.
    refetchInterval: 30_000,
  });
}

export function useUpdatesHistory(limit = 20) {
  return useQuery<RunHistoryEntry[], Error>({
    queryKey: [...QK_HISTORY, limit] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/system/updates-history?limit=${limit}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { runs: RunHistoryEntry[] };
      return body.runs;
    },
    refetchInterval: 30_000,
  });
}

export function useUpdatePolicyMutation() {
  return useCsrfMutation<UpdatePolicy, Partial<UpdatePolicy>>({
    url: '/api/system/updates-policy',
    method: 'PATCH',
    invalidateKeys: [[...QK_POLICY], [...QK_HISTORY]],
  });
}

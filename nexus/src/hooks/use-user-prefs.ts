'use client';

/**
 * TanStack Query hook for the authenticated user's UI prefs.
 *
 * Reads the single `/api/user-prefs` document on mount; exposes a
 * mutation that PATCHes a layout for a specific preset (or null to
 * reset to the built-in).
 *
 * Kept as a thin wrapper — BentoGrid drives the layout with local
 * React state and only calls saveLayout when the user drops a cell,
 * so DnD doesn't feel network-bound.
 */
import { useQuery } from '@tanstack/react-query';
import { readError, useCsrfMutation } from '@/lib/create-csrf-mutation';
import type { CustomLayout, UserPrefs } from '@/lib/user-prefs/types';
import type { BentoPreset } from '@/lib/widgets/registry';

const QK_PREFS = ['user-prefs'] as const;

export function useUserPrefs() {
  return useQuery<UserPrefs, Error>({
    queryKey: QK_PREFS,
    queryFn: async () => {
      const res = await fetch('/api/user-prefs', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as UserPrefs;
    },
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}

interface SaveLayoutVariables {
  /** Preset id whose layout is being overridden, or reset (null layout). */
  presetId: BentoPreset['id'];
  /** null → drop override, back to built-in. */
  layout: CustomLayout | null;
}

export function useSaveLayout() {
  return useCsrfMutation<UserPrefs, SaveLayoutVariables>({
    url: '/api/user-prefs',
    method: 'PATCH',
    invalidateKeys: [[...QK_PREFS]],
    body: (v) => ({ bentoLayouts: { [v.presetId]: v.layout } }),
  });
}

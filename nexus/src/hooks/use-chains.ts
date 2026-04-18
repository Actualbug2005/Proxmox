/**
 * React Query hooks for the /api/scripts/chains endpoints.
 *
 * Mirrors use-scheduled-jobs shapes (CSRF header, query-key factory,
 * invalidate-on-mutate) so the chain UI can share muscle memory with the
 * single-script schedule UI.
 *
 * Progress polling: `useChain(id, { live })` polls the detail endpoint at
 * 2s cadence when `live` is true — the list page flips that on for rows
 * whose lastRun includes any pending/running step so the progress panel
 * updates without flooding the API for idle chains.
 */

import { useQuery } from '@tanstack/react-query';
import { useCsrfMutation, readError } from '@/lib/create-csrf-mutation';
import type { ChainDto, ChainStepDto } from '@/lib/chains-dto';
import type {
  ChainStepPolicy,
  ChainStepRun,
} from '@/lib/chains-store';

export type { ChainDto, ChainStepDto, ChainStepPolicy, ChainStepRun };

export interface ChainStepInput {
  slug?: string;
  scriptUrl: string;
  scriptName: string;
  node: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface CreateChainInput {
  name: string;
  description?: string;
  steps: ChainStepInput[];
  policy?: ChainStepPolicy;
  schedule?: string;
  enabled?: boolean;
}

export interface UpdateChainInput {
  name?: string;
  description?: string;
  steps?: ChainStepInput[];
  policy?: ChainStepPolicy;
  schedule?: string | null;
  enabled?: boolean;
}

const LIST_KEY = ['chains', 'list'] as const;
const chainKey = (id: string) => ['chains', 'one', id] as const;

export function useChains() {
  return useQuery<{ chains: ChainDto[] }, Error>({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const res = await fetch('/api/scripts/chains');
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { chains: ChainDto[] };
    },
    staleTime: 5_000,
  });
}

/**
 * Same endpoint as `useChains` but adaptively polls at 2s whenever any
 * chain has a pending/running step, and falls back to 30s otherwise.
 * Cadence switches automatically as chain state advances.
 *
 * The floating progress panel uses this so an in-flight chain is reactive
 * without pinging the server once the dust settles.
 */
export function useChainsLive() {
  return useQuery<{ chains: ChainDto[] }, Error>({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const res = await fetch('/api/scripts/chains');
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { chains: ChainDto[] };
    },
    staleTime: 0,
    refetchInterval: (query) => {
      const chains = query.state.data?.chains ?? [];
      return chains.some(isChainInFlight) ? 2_000 : 30_000;
    },
  });
}

export function useChain(id: string | null, opts: { live?: boolean } = {}) {
  return useQuery<{ chain: ChainDto }, Error>({
    queryKey: id ? chainKey(id) : (['chains', 'one', 'none'] as const),
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/scripts/chains/${encodeURIComponent(id!)}`);
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { chain: ChainDto };
    },
    refetchInterval: opts.live ? 2_000 : false,
    staleTime: opts.live ? 0 : 5_000,
  });
}

export function useCreateChain() {
  return useCsrfMutation<{ chain: ChainDto }, CreateChainInput>({
    url: '/api/scripts/chains',
    method: 'POST',
    invalidateKeys: [[...LIST_KEY]],
  });
}

interface UpdateChainCall {
  id: string;
  patch: UpdateChainInput;
}

export function useUpdateChain() {
  return useCsrfMutation<{ chain: ChainDto }, UpdateChainCall>({
    url: (input) => `/api/scripts/chains/${encodeURIComponent(input.id)}`,
    method: 'PATCH',
    body: (input) => input.patch,
    invalidateKeys: (_data, vars) => [[...LIST_KEY], [...chainKey(vars.id)]],
  });
}

export function useDeleteChain() {
  return useCsrfMutation<{ removed: true }, string>({
    url: (id) => `/api/scripts/chains/${encodeURIComponent(id)}`,
    method: 'DELETE',
    invalidateKeys: [[...LIST_KEY]],
  });
}

export function useRunChain() {
  return useCsrfMutation<{ started: boolean; chainId: string }, string>({
    url: (id) => `/api/scripts/chains/${encodeURIComponent(id)}/run`,
    method: 'POST',
    // The run endpoint takes no body — just the URL path + CSRF header.
    sendBody: false,
    invalidateKeys: (_data, id) => [[...LIST_KEY], [...chainKey(id)]],
  });
}

/**
 * Handy predicate for the progress panel — `true` while any step is still
 * pending or running, which is the condition to keep the 2s poll hot.
 */
export function isChainInFlight(chain: Pick<ChainDto, 'lastRun'> | undefined): boolean {
  if (!chain?.lastRun) return false;
  return chain.lastRun.some((s) => s.status === 'pending' || s.status === 'running');
}

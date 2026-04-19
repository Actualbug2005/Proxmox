'use client';

/**
 * TanStack Query + CSRF hooks for the notifications engine.
 *
 * Hooks are organised around the three resource types (destinations,
 * rules, recent dispatches) so consumers only import what they need.
 * Mutation hooks use `useCsrfMutation`, which handles the double-submit
 * header + invalidation keys uniformly with the rest of the app.
 */
import { useQuery } from '@tanstack/react-query';
import { readError, useCsrfMutation } from '@/lib/create-csrf-mutation';
import type {
  BackoffConfig,
  DestinationConfig,
  DispatchRecord,
  ResolvePolicy,
  Rule,
  RuleMatch,
} from '@/lib/notifications/types';
import type { DestinationSummary } from '@/app/api/notifications/destinations/route';

// Stable polling cadence across the notifications UI — matches the
// 30 s rule-of-thumb we use on /api/system/health, since the dispatch
// ring buffer updates at a similar frequency (once per event).
const POLL_MS = 30_000;

const QK = {
  destinations: ['notifications', 'destinations'] as const,
  rules:        ['notifications', 'rules'] as const,
  recent:       ['notifications', 'recent'] as const,
};

// ─── Destinations ──────────────────────────────────────────────────────────

export function useDestinations() {
  return useQuery<DestinationSummary[], Error>({
    queryKey: QK.destinations,
    queryFn: async () => {
      const res = await fetch('/api/notifications/destinations', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { destinations: DestinationSummary[] };
      return body.destinations;
    },
    refetchInterval: POLL_MS,
  });
}

export interface DestinationCreateInput {
  name: string;
  config: DestinationConfig;
}

export function useCreateDestination() {
  return useCsrfMutation<{ destination: DestinationSummary }, DestinationCreateInput>({
    url: '/api/notifications/destinations',
    method: 'POST',
    invalidateKeys: [[...QK.destinations]],
  });
}

export interface DestinationUpdateInput {
  id: string;
  patch: Partial<DestinationCreateInput>;
}

export function useUpdateDestination() {
  return useCsrfMutation<{ destination: DestinationSummary }, DestinationUpdateInput>({
    url: ({ id }) => `/api/notifications/destinations/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: ({ patch }) => patch,
    invalidateKeys: [[...QK.destinations]],
  });
}

export function useDeleteDestination() {
  return useCsrfMutation<{ ok: true }, string>({
    url: (id) => `/api/notifications/destinations/${encodeURIComponent(id)}`,
    method: 'DELETE',
    // Deleting a destination cascades to its rules server-side, so
    // both lists need a refetch.
    invalidateKeys: [[...QK.destinations], [...QK.rules]],
  });
}

export interface TestDestinationResult {
  outcome: 'sent' | 'failed';
  status?: number;
  reason?: string;
}

export function useTestDestination() {
  return useCsrfMutation<TestDestinationResult, string>({
    url: (id) => `/api/notifications/destinations/${encodeURIComponent(id)}/test`,
    method: 'POST',
    // Test fires don't advance rule state or modify destinations — no
    // invalidation needed; the caller surfaces the outcome directly.
  });
}

// ─── Rules ─────────────────────────────────────────────────────────────────

export function useRules() {
  return useQuery<Rule[], Error>({
    queryKey: QK.rules,
    queryFn: async () => {
      const res = await fetch('/api/notifications/rules', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { rules: Rule[] };
      return body.rules;
    },
    refetchInterval: POLL_MS,
  });
}

export interface RuleCreateInput {
  name: string;
  enabled?: boolean;
  match: RuleMatch;
  destinationId: string;
  messageTemplate: string;
  resolveMessageTemplate?: string;
  title?: string;
  backoff?: BackoffConfig;
  resolvePolicy?: ResolvePolicy;
}

export function useCreateRule() {
  return useCsrfMutation<{ rule: Rule }, RuleCreateInput>({
    url: '/api/notifications/rules',
    method: 'POST',
    invalidateKeys: [[...QK.rules]],
  });
}

export interface RuleUpdateInput {
  id: string;
  patch: Partial<RuleCreateInput>;
}

export function useUpdateRule() {
  return useCsrfMutation<{ rule: Rule }, RuleUpdateInput>({
    url: ({ id }) => `/api/notifications/rules/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: ({ patch }) => patch,
    invalidateKeys: [[...QK.rules]],
  });
}

export function useDeleteRule() {
  return useCsrfMutation<{ ok: true }, string>({
    url: (id) => `/api/notifications/rules/${encodeURIComponent(id)}`,
    method: 'DELETE',
    invalidateKeys: [[...QK.rules]],
  });
}

// ─── Recent dispatches ─────────────────────────────────────────────────────

export function useRecentDispatches(limit = 50) {
  return useQuery<DispatchRecord[], Error>({
    queryKey: [...QK.recent, limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/notifications/recent?limit=${limit}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { dispatches: DispatchRecord[] };
      return body.dispatches;
    },
    refetchInterval: POLL_MS,
  });
}

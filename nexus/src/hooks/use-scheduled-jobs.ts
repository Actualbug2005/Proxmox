/**
 * React Query hooks for the /api/scripts/schedules endpoints.
 *
 * Mirror of use-script-jobs.ts shapes (CSRF header, query-key factory,
 * invalidate-on-mutate) so any future refactor there can flow here without
 * a separate rethink.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { readCsrfCookie } from '@/lib/proxmox-client';
import { readError } from '@/lib/create-csrf-mutation';
import type { ScheduledJobDto } from '@/lib/scheduled-jobs-dto';

export type { ScheduledJobDto };

export interface CreateScheduledJobInput {
  slug?: string;
  scriptUrl: string;
  scriptName: string;
  node: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  schedule: string;
  enabled?: boolean;
}

export interface UpdateScheduledJobInput {
  slug?: string;
  scriptUrl?: string;
  scriptName?: string;
  node?: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  schedule?: string;
  enabled?: boolean;
}

const LIST_KEY = ['scheduled-jobs', 'list'] as const;

export function useScheduledJobs() {
  return useQuery<{ jobs: ScheduledJobDto[] }, Error>({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const res = await fetch('/api/scripts/schedules');
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { jobs: ScheduledJobDto[] };
    },
    staleTime: 10_000,
  });
}

export function useCreateScheduledJob() {
  const qc = useQueryClient();
  return useMutation<{ job: ScheduledJobDto }, Error, CreateScheduledJobInput>({
    mutationFn: async (input) => {
      const csrf = readCsrfCookie();
      const res = await fetch('/api/scripts/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { job: ScheduledJobDto };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useUpdateScheduledJob() {
  const qc = useQueryClient();
  return useMutation<
    { job: ScheduledJobDto },
    Error,
    { id: string; patch: UpdateScheduledJobInput }
  >({
    mutationFn: async ({ id, patch }) => {
      const csrf = readCsrfCookie();
      const res = await fetch(`/api/scripts/schedules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { job: ScheduledJobDto };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useDeleteScheduledJob() {
  const qc = useQueryClient();
  return useMutation<{ removed: boolean }, Error, string>({
    mutationFn: async (id) => {
      const csrf = readCsrfCookie();
      const res = await fetch(`/api/scripts/schedules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}) },
      });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as { removed: boolean };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

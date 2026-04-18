/**
 * React Query hooks for the /api/scripts/schedules endpoints.
 *
 * Mirror of use-script-jobs.ts shapes (CSRF header, query-key factory,
 * invalidate-on-mutate) so any future refactor there can flow here without
 * a separate rethink.
 */

import { useQuery } from '@tanstack/react-query';
import { useCsrfMutation, readError } from '@/lib/create-csrf-mutation';
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
  return useCsrfMutation<{ job: ScheduledJobDto }, CreateScheduledJobInput>({
    url: '/api/scripts/schedules',
    method: 'POST',
    invalidateKeys: [[...LIST_KEY]],
  });
}

// PATCH needs the id in the URL AND the patch as the body. useCsrfMutation's
// `body` transformer lets us derive each from the same TInput.
interface UpdateScheduledJobCall {
  id: string;
  patch: UpdateScheduledJobInput;
}

export function useUpdateScheduledJob() {
  return useCsrfMutation<{ job: ScheduledJobDto }, UpdateScheduledJobCall>({
    url: (input) => `/api/scripts/schedules/${encodeURIComponent(input.id)}`,
    method: 'PATCH',
    body: (input) => input.patch,
    invalidateKeys: [[...LIST_KEY]],
  });
}

export function useDeleteScheduledJob() {
  return useCsrfMutation<{ removed: boolean }, string>({
    url: (id) => `/api/scripts/schedules/${encodeURIComponent(id)}`,
    method: 'DELETE',
    invalidateKeys: [[...LIST_KEY]],
  });
}

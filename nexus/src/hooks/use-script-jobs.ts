/**
 * React Query hooks for the script-jobs endpoints.
 *
 *   useScriptJobs()           — recent jobs for the current user (polls
 *                               every 3 s while any job is running).
 *   useScriptJobDetail(id)    — full job record + log (polls every 2 s
 *                               until status !== "running").
 *   useStartScriptJob()       — mutation that POSTs to /api/scripts/run
 *                               and invalidates the list on success.
 *   useAbortScriptJob()       — mutation that DELETEs a running job.
 *
 * These hooks live in one module so the polling cadence and cache keys
 * stay consistent across the status bar, drawer, and scripts page.
 */

import { useQuery } from '@tanstack/react-query';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import type { JobSummary } from '@/app/api/scripts/jobs/route';

export type { JobSummary };

export interface JobDetail extends JobSummary {
  scriptUrl: string;
  env?: Record<string, string>;
  /** In-memory ring tail (<=64 KB). Always present. */
  tail: string;
  /** On-disk log (up to 4 MB from the end). Empty when client passes tail=0. */
  log: string;
}

export interface StartScriptJobInput {
  node: string;
  scriptUrl: string;
  scriptName: string;
  slug?: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface StartScriptJobResponse {
  jobId: string;
  startedAt: number;
  rejectedEnvKeys?: string[];
}

/**
 * Recent jobs for the signed-in user. The polling interval is adaptive —
 * 3 s while any job is running, 30 s otherwise — so the status bar stays
 * live without generating needless traffic when the cluster is idle.
 */
export function useScriptJobs() {
  return useQuery<{ jobs: JobSummary[] }, Error>({
    queryKey: ['script-jobs', 'list'],
    queryFn: async () => {
      const res = await fetch('/api/scripts/jobs?limit=20');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { jobs: JobSummary[] };
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      const running = data?.jobs.some((j) => j.status === 'running') ?? false;
      return running ? 3_000 : 30_000;
    },
    staleTime: 1_000,
  });
}

export function useScriptJobDetail(jobId: string | null) {
  return useQuery<JobDetail, Error>({
    queryKey: ['script-jobs', 'detail', jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const res = await fetch(`/api/scripts/jobs/${encodeURIComponent(jobId!)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as JobDetail;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      // Keep polling while the job is still running, plus one extra tick so
      // the UI sees the final log flush after onClose fires server-side.
      if (!data) return 2_000;
      return data.status === 'running' ? 2_000 : false;
    },
  });
}

export function useStartScriptJob() {
  return useCsrfMutation<StartScriptJobResponse, StartScriptJobInput>({
    url: '/api/scripts/run',
    method: 'POST',
    invalidateKeys: [['script-jobs', 'list']],
  });
}

export function useAbortScriptJob() {
  return useCsrfMutation<{ aborted: boolean }, string>({
    url: (jobId) => `/api/scripts/jobs/${encodeURIComponent(jobId)}`,
    method: 'DELETE',
    invalidateKeys: (_data, jobId) => [
      ['script-jobs', 'list'],
      ['script-jobs', 'detail', jobId],
    ],
  });
}

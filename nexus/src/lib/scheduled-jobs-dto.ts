/**
 * Wire-shape DTO for the /api/scripts/schedules endpoints.
 *
 * Lives in lib/ (not the route file) because Next.js route files may only
 * export HTTP verbs + a fixed set of segment config. Kept in lockstep with
 * ScheduledJob minus fields that shouldn't leak across users or serve no
 * UI purpose.
 */

import type { ScheduledJob } from '@/lib/scheduled-jobs-store';

export interface ScheduledJobDto {
  id: string;
  owner: string;
  slug?: string;
  scriptUrl: string;
  scriptName: string;
  node: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  schedule: string;
  enabled: boolean;
  lastFiredAt?: number;
  lastJobId?: string;
  createdAt: number;
  updatedAt: number;
}

export function toDto(job: ScheduledJob): ScheduledJobDto {
  return {
    id: job.id,
    owner: job.owner,
    slug: job.slug,
    scriptUrl: job.scriptUrl,
    scriptName: job.scriptName,
    node: job.node,
    method: job.method,
    env: job.env,
    timeoutMs: job.timeoutMs,
    schedule: job.schedule,
    enabled: job.enabled,
    lastFiredAt: job.lastFiredAt,
    lastJobId: job.lastJobId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

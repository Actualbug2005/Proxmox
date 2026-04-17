/**
 * Wire-shape DTOs for the /api/scripts/chains endpoints.
 *
 * Lives in lib/ (not the route file) because Next.js route files may only
 * export HTTP verbs + a fixed set of segment config. Utility types and
 * converters must travel through a sibling module.
 */

import type { Chain, ChainStepPolicy, ChainStepRun } from '@/lib/chains-store';

export interface ChainStepDto {
  slug?: string;
  scriptUrl: string;
  scriptName: string;
  node: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ChainDto {
  id: string;
  owner: string;
  name: string;
  description?: string;
  steps: ChainStepDto[];
  policy: ChainStepPolicy;
  schedule?: string;
  enabled: boolean;
  lastFiredAt?: number;
  lastRun?: ChainStepRun[];
  createdAt: number;
  updatedAt: number;
}

export function toDto(c: Chain): ChainDto {
  return {
    id: c.id,
    owner: c.owner,
    name: c.name,
    description: c.description,
    steps: c.steps.map((s) => ({ ...s })),
    policy: c.policy,
    schedule: c.schedule,
    enabled: c.enabled,
    lastFiredAt: c.lastFiredAt,
    lastRun: c.lastRun,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

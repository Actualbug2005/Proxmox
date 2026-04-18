/**
 * Persistent store for script chains — ordered sequences of Community
 * Scripts that the user composes, runs ad-hoc, or schedules on a cron.
 *
 * Storage: single JSON file at ${NEXUS_DATA_DIR}/scheduled-chains.json.
 *
 * Parallel to scheduled-jobs-store.ts rather than extending it because:
 *   - Single-script schedules are a tight, stable shape; union'ing a
 *     `steps?: Step[]` field on ScheduledJob would force every caller to
 *     branch at the type level.
 *   - Backups and migrations stay independent — the chain schema can
 *     evolve without breaking the single-job path.
 *
 * Concurrency: shared-mutex pattern from scheduled-jobs-store. Reads go
 * through the same mutex so they observe the latest committed state.
 */

import { promises as fsp } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChainStepPolicy = 'halt-on-failure' | 'continue';

export type ChainStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface ChainStep {
  slug?: string;
  scriptUrl: string;
  scriptName: string;
  node: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Discriminated by `status` so each lifecycle state only carries the
 * fields that are meaningful for it. A `pending` row with a `finishedAt`
 * is a bug the compiler now rejects.
 *
 * Persisted inside `Chain.lastRun` in scheduled-chains.json — old records
 * (pre-0.8.4) used a single loose interface with every field optional.
 * `sanitiseChainStepRun` below strips fields the old shape may have
 * carried that don't belong on the new state.
 */
export interface PendingChainStepRun {
  stepIndex: number;
  status: 'pending';
}
export interface RunningChainStepRun {
  stepIndex: number;
  status: 'running';
  startedAt: number;
  jobId?: string;
}
export interface SuccessChainStepRun {
  stepIndex: number;
  status: 'success';
  startedAt: number;
  finishedAt: number;
  jobId: string;
}
export interface FailedChainStepRun {
  stepIndex: number;
  status: 'failed';
  startedAt: number;
  finishedAt: number;
  error: string;
  /** Optional — missing when dispatch/validation failed before a job was created. */
  jobId?: string;
}
export interface SkippedChainStepRun {
  stepIndex: number;
  status: 'skipped';
}

export type ChainStepRun =
  | PendingChainStepRun
  | RunningChainStepRun
  | SuccessChainStepRun
  | FailedChainStepRun
  | SkippedChainStepRun;

/**
 * Accept arbitrary JSON-decoded input and narrow it to the union. Old
 * persisted records had fields (error on success rows, finishedAt on
 * pending rows) that the new type rejects; strip them rather than fail
 * the whole load. Returns null for shapes that can't be salvaged.
 */
export function sanitiseChainStepRun(raw: unknown): ChainStepRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const stepIndex = typeof r.stepIndex === 'number' ? r.stepIndex : null;
  const status = typeof r.status === 'string' ? r.status : null;
  if (stepIndex === null || !status) return null;
  const startedAt = typeof r.startedAt === 'number' ? r.startedAt : undefined;
  const finishedAt = typeof r.finishedAt === 'number' ? r.finishedAt : undefined;
  const jobId = typeof r.jobId === 'string' ? r.jobId : undefined;
  const error = typeof r.error === 'string' ? r.error : undefined;
  switch (status) {
    case 'pending':
      return { stepIndex, status: 'pending' };
    case 'running':
      return { stepIndex, status: 'running', startedAt: startedAt ?? 0, jobId };
    case 'success':
      if (!jobId || startedAt === undefined || finishedAt === undefined) return null;
      return { stepIndex, status: 'success', startedAt, finishedAt, jobId };
    case 'failed':
      if (startedAt === undefined || finishedAt === undefined) return null;
      return { stepIndex, status: 'failed', startedAt, finishedAt, error: error ?? 'Unknown error', jobId };
    case 'skipped':
      return { stepIndex, status: 'skipped' };
    default:
      return null;
  }
}

export interface Chain {
  id: string;
  /** PVE userid that owns the chain. Only the owner can edit / run / delete. */
  owner: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  policy: ChainStepPolicy;
  /** Optional 5-field cron. Empty / undefined = ad-hoc only. */
  schedule?: string;
  /** Whether the scheduler should fire this chain. Ignored when schedule is blank. */
  enabled: boolean;
  /** Epoch ms of the last fire. Undefined on a never-fired chain. */
  lastFiredAt?: number;
  /** Per-step run state from the last fire, same length + order as `steps`. */
  lastRun?: ChainStepRun[];
  /** Error string from the most recent fire, if that fire failed. Cleared
   *  on the next successful fire. */
  lastFireError?: string;
  /** Count of consecutive failed fires. Drives the scheduler's auto-disable
   *  threshold (see scheduler.ts). */
  consecutiveFailures?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChainInput {
  owner: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  policy?: ChainStepPolicy;
  schedule?: string;
  enabled?: boolean;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(tmpdir(), 'nexus-data');
}

const DATA_DIR = resolveDataDir();
const FILE = join(DATA_DIR, 'scheduled-chains.json');

mkdirSync(DATA_DIR, { recursive: true });

// ─── File IO ─────────────────────────────────────────────────────────────────

interface FileShape {
  version: 1;
  chains: Chain[];
}

const EMPTY: FileShape = { version: 1, chains: [] };

async function readFile(): Promise<FileShape> {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as FileShape;
    if (parsed.version !== 1 || !Array.isArray(parsed.chains)) return EMPTY;
    // Pre-0.8.4 lastRun rows had a single loose shape — re-narrow on read so
    // the in-memory union stays sound. Rows that can't be salvaged are
    // dropped (the chain still loads, just without a stale run history).
    for (const c of parsed.chains) {
      if (Array.isArray(c.lastRun)) {
        const cleaned: ChainStepRun[] = [];
        for (const r of c.lastRun) {
          const sane = sanitiseChainStepRun(r);
          if (sane) cleaned.push(sane);
        }
        c.lastRun = cleaned;
      }
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw err;
  }
}

async function writeFile(state: FileShape): Promise<void> {
  // Atomic rename: temp file first so a crash mid-write doesn't leave a
  // truncated scheduled-chains.json that would lose every chain definition.
  const tmp = `${FILE}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fsp.rename(tmp, FILE);
}

// ─── Mutex ───────────────────────────────────────────────────────────────────

let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function list(): Promise<Chain[]> {
  return serialize(async () => (await readFile()).chains);
}

export async function listForUser(owner: string): Promise<Chain[]> {
  return serialize(async () => {
    const state = await readFile();
    return state.chains.filter((c) => c.owner === owner);
  });
}

export async function get(id: string): Promise<Chain | null> {
  return serialize(async () => {
    const state = await readFile();
    return state.chains.find((c) => c.id === id) ?? null;
  });
}

export async function create(input: ChainInput): Promise<Chain> {
  return serialize(async () => {
    const state = await readFile();
    const now = Date.now();
    const c: Chain = {
      id: randomUUID(),
      owner: input.owner,
      name: input.name,
      description: input.description,
      steps: input.steps,
      policy: input.policy ?? 'halt-on-failure',
      schedule: input.schedule,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    state.chains.push(c);
    await writeFile(state);
    return c;
  });
}

/** Partial update. Returns the new record or null if id unknown. */
export async function update(
  id: string,
  patch: Partial<Omit<Chain, 'id' | 'owner' | 'createdAt'>>,
): Promise<Chain | null> {
  return serialize(async () => {
    const state = await readFile();
    const idx = state.chains.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const merged: Chain = {
      ...state.chains[idx],
      ...patch,
      id: state.chains[idx].id,
      owner: state.chains[idx].owner,
      createdAt: state.chains[idx].createdAt,
      updatedAt: Date.now(),
    };
    state.chains[idx] = merged;
    await writeFile(state);
    return merged;
  });
}

export async function remove(id: string): Promise<boolean> {
  return serialize(async () => {
    const state = await readFile();
    const before = state.chains.length;
    state.chains = state.chains.filter((c) => c.id !== id);
    if (state.chains.length === before) return false;
    await writeFile(state);
    return true;
  });
}

/**
 * Replace the `lastRun` array for `id` and stamp updatedAt. Used by the
 * chain runner on every step transition so the UI's poll surfaces
 * progress live. Silently no-ops if the chain is gone (user deleted
 * mid-run).
 */
export async function setLastRun(id: string, runSteps: ChainStepRun[]): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    const idx = state.chains.findIndex((c) => c.id === id);
    if (idx === -1) return;
    state.chains[idx] = {
      ...state.chains[idx],
      lastRun: runSteps,
      updatedAt: Date.now(),
    };
    await writeFile(state);
  });
}

/**
 * Mark the fire timestamp. Sibling of setLastRun so the scheduler can
 * update just the `lastFiredAt` for dedup without touching the in-flight
 * step state.
 *
 * Pass `error` to mark the fire as failed: the error message is recorded
 * and `consecutiveFailures` increments. A successful fire (omit `error`)
 * clears both error fields and resets the counter to 0.
 */
export async function markFired(id: string, at: number, error?: string): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    const idx = state.chains.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const prev = state.chains[idx];
    state.chains[idx] = error
      ? {
          ...prev,
          lastFiredAt: at,
          lastFireError: error,
          consecutiveFailures: (prev.consecutiveFailures ?? 0) + 1,
          updatedAt: at,
        }
      : {
          ...prev,
          lastFiredAt: at,
          lastFireError: undefined,
          consecutiveFailures: 0,
          updatedAt: at,
        };
    await writeFile(state);
  });
}

// ─── Introspection (testing / debug) ─────────────────────────────────────────

export function dataPath(): string {
  return FILE;
}

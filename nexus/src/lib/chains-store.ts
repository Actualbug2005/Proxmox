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

export interface ChainStepRun {
  stepIndex: number;
  status: ChainStepStatus;
  jobId?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
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
 */
export async function markFired(id: string, at: number): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    const idx = state.chains.findIndex((c) => c.id === id);
    if (idx === -1) return;
    state.chains[idx] = {
      ...state.chains[idx],
      lastFiredAt: at,
      updatedAt: at,
    };
    await writeFile(state);
  });
}

// ─── Introspection (testing / debug) ─────────────────────────────────────────

export function dataPath(): string {
  return FILE;
}

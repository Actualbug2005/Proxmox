/**
 * Persistent store for scheduled community-script jobs.
 *
 * Storage: single JSON file at ${NEXUS_DATA_DIR}/scheduled-jobs.json.
 *
 * Why JSON on disk and not Redis or SQLite:
 *   - The dataset is tiny (tens to low hundreds of records per cluster).
 *   - Redis is opt-in via REDIS_URL (session-store.ts); we need schedules to
 *     survive a restart even on single-node installs where Redis isn't set.
 *   - A dedicated SQLite adds a binary dep and a schema-migration story for
 *     one-and-a-half tables' worth of data.
 *
 * Concurrency: Node's one-at-a-time event loop gives us single-writer by
 * default, but nested async code can still interleave a read+write. A
 * module-scoped mutex serialises every mutation. Reads also go through the
 * mutex so they observe the latest committed state.
 */

import { promises as fsp } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScheduledJob {
  id: string;
  /** PVE userid that owns the schedule, e.g. "root@pam". Only the owner can edit. */
  owner: string;
  slug?: string;
  scriptUrl: string;
  scriptName: string;
  node: string;
  method?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** 5-field cron expression (see cron-match.ts for accepted grammar). */
  schedule: string;
  enabled: boolean;
  /** Unix-epoch ms of the last fire. Undefined on a never-fired job. */
  lastFiredAt?: number;
  /** jobId of the last fire — follow this into /api/scripts/jobs/[id] for logs. */
  lastJobId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledJobInput {
  owner: string;
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

// ─── Paths ───────────────────────────────────────────────────────────────────

/**
 * Resolve the data directory at module load. Operators running in the
 * Proxmox LXC set NEXUS_DATA_DIR to /var/lib/nexus; dev fallbacks to the
 * system tmpdir so `npm run dev` on a fresh clone doesn't require root.
 */
function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(tmpdir(), 'nexus-data');
}

const DATA_DIR = resolveDataDir();
const FILE = join(DATA_DIR, 'scheduled-jobs.json');

mkdirSync(DATA_DIR, { recursive: true });

// ─── File IO ─────────────────────────────────────────────────────────────────

interface FileShape {
  version: 1;
  jobs: ScheduledJob[];
}

const EMPTY: FileShape = { version: 1, jobs: [] };

async function readFile(): Promise<FileShape> {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as FileShape;
    if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) return EMPTY;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw err;
  }
}

async function writeFile(state: FileShape): Promise<void> {
  // Atomic rename: write to a temp file first so a crash mid-write doesn't
  // leave a truncated scheduled-jobs.json that would lose every schedule.
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

export async function list(): Promise<ScheduledJob[]> {
  return serialize(async () => (await readFile()).jobs);
}

export async function listForUser(owner: string): Promise<ScheduledJob[]> {
  return serialize(async () => {
    const state = await readFile();
    return state.jobs.filter((j) => j.owner === owner);
  });
}

export async function get(id: string): Promise<ScheduledJob | null> {
  return serialize(async () => {
    const state = await readFile();
    return state.jobs.find((j) => j.id === id) ?? null;
  });
}

export async function create(input: ScheduledJobInput): Promise<ScheduledJob> {
  return serialize(async () => {
    const state = await readFile();
    const now = Date.now();
    const job: ScheduledJob = {
      id: randomUUID(),
      owner: input.owner,
      slug: input.slug,
      scriptUrl: input.scriptUrl,
      scriptName: input.scriptName,
      node: input.node,
      method: input.method,
      env: input.env,
      timeoutMs: input.timeoutMs,
      schedule: input.schedule,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    state.jobs.push(job);
    await writeFile(state);
    return job;
  });
}

/** Partial update; returns the new record or null if the id was unknown. */
export async function update(
  id: string,
  patch: Partial<Omit<ScheduledJob, 'id' | 'owner' | 'createdAt'>>,
): Promise<ScheduledJob | null> {
  return serialize(async () => {
    const state = await readFile();
    const idx = state.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    const merged: ScheduledJob = {
      ...state.jobs[idx],
      ...patch,
      id: state.jobs[idx].id,
      owner: state.jobs[idx].owner,
      createdAt: state.jobs[idx].createdAt,
      updatedAt: Date.now(),
    };
    state.jobs[idx] = merged;
    await writeFile(state);
    return merged;
  });
}

export async function remove(id: string): Promise<boolean> {
  return serialize(async () => {
    const state = await readFile();
    const before = state.jobs.length;
    state.jobs = state.jobs.filter((j) => j.id !== id);
    if (state.jobs.length === before) return false;
    await writeFile(state);
    return true;
  });
}

/**
 * Record that a fire happened for `id` — sets lastFiredAt + lastJobId and
 * bumps updatedAt. Atomic with the readFile/writeFile pair.
 */
export async function markFired(id: string, jobId: string | undefined, at: number): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    const idx = state.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return;
    state.jobs[idx] = {
      ...state.jobs[idx],
      lastFiredAt: at,
      lastJobId: jobId,
      updatedAt: at,
    };
    await writeFile(state);
  });
}

// ─── Introspection (testing / debug) ─────────────────────────────────────────

export function dataPath(): string {
  return FILE;
}

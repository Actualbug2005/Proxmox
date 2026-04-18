/**
 * Persistent run history for scheduled jobs and chains (7.6).
 *
 * Appended every time the scheduler fires one of these sources. Records:
 * who, what source id, when, terminal status, exit code, duration, and
 * (on failure) a short error string. The underlying job log is kept
 * by `script-jobs.ts` for 24 h — this store records just enough that a
 * schedule detail drawer can show "last 20 runs" long after the job
 * log has been GC'd.
 *
 * Single file at ${NEXUS_DATA_DIR}/run-history.jsonl. One entry per line
 * for grep/jq friendliness. Reader loads the last N lines; on overflow
 * we rotate to `.1` so the hot file stays small.
 *
 * Why not reuse exec-audit's SAFE tier: exec-audit is scoped to raw
 * exec + scripts.run commands and has an envelope-encryption story tied
 * to incident response. Scheduled-job outcomes are ops-level metadata,
 * not executed commands — mixing them into the same log would blur the
 * decryption boundary.
 */

import { promises as fsp } from 'node:fs';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type RunSource = 'schedule' | 'chain';
export type RunOutcome = 'success' | 'failed' | 'skipped';

export interface RunHistoryEntry {
  /** Unix ms when the fire started. */
  at: number;
  source: RunSource;
  /** Schedule id or chain id. Unique within (source). */
  sourceId: string;
  /** Underlying script job id — follow into /api/scripts/jobs/[id] while it
   *  still exists. Omitted when the fire was skipped before spawning. */
  jobId?: string;
  outcome: RunOutcome;
  /** Exit code when known (null for signal/timeout kills). */
  exitCode?: number | null;
  /** Wall-clock duration in ms. Omitted if the fire never completed. */
  durationMs?: number;
  /** Short error string on failure / skip. */
  error?: string;
}

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(tmpdir(), 'nexus-data');
}

const DATA_DIR = resolveDataDir();
const FILE = join(DATA_DIR, 'run-history.jsonl');
const ROTATED = `${FILE}.1`;
const ROTATE_BYTES = 2 * 1024 * 1024; // 2 MB before rotation
const MAX_READ_LINES = 2000; // bound the read side

mkdirSync(DATA_DIR, { recursive: true });

// Per-process chain so concurrent appends don't interleave lines even
// though appendFile itself is atomic per call on POSIX.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const s = statSync(FILE);
    if (s.size < ROTATE_BYTES) return;
    await fsp.rename(FILE, ROTATED);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function appendRun(entry: RunHistoryEntry): Promise<void> {
  await serialize(async () => {
    await rotateIfNeeded();
    await fsp.appendFile(FILE, JSON.stringify(entry) + '\n', 'utf8');
  });
}

/**
 * Return the newest `limit` entries for `(source, sourceId)`, ordered
 * newest-first. Reads the hot file; the rotated file is intentionally
 * NOT included — history deeper than the last rotation point is cold
 * and wasn't promised to the UI. Callers that want a deeper trawl can
 * grep `run-history.jsonl.1` directly.
 */
export async function listRuns(
  source: RunSource,
  sourceId: string,
  limit = 20,
): Promise<RunHistoryEntry[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(FILE, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const lines = raw.split('\n').slice(-MAX_READ_LINES);
  const out: RunHistoryEntry[] = [];
  // Walk bottom-up so we gather the newest matches first and can stop
  // at `limit` without parsing the whole file when it's mostly other
  // sources.
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as RunHistoryEntry;
      if (parsed.source === source && parsed.sourceId === sourceId) {
        out.push(parsed);
      }
    } catch {
      // Corrupt line (partial write, power loss) — skip quietly.
      continue;
    }
  }
  return out;
}

export const __testing = {
  dataPath(): string {
    return FILE;
  },
} as const;

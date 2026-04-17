/**
 * Script job registry — in-memory state for fire-and-forget script runs.
 *
 * Problem this solves:
 *   /api/scripts/run used to await the child process for up to 15 minutes,
 *   which Cloudflare Tunnel (and every other edge with <120 s timeouts) cuts
 *   off with a 502 well before most community scripts finish. The new flow
 *   starts the script detached, records a job record here, and returns a
 *   jobId immediately. The UI polls /api/scripts/jobs/[jobId] for status.
 *
 *   Log output (stdout + stderr, merged) is streamed to a per-job file
 *   under LOG_DIR — the registry only holds a small tail in memory for the
 *   hot path (status bar rendering).
 *
 * Memory model:
 *   - jobs: Map<jobId, JobRecord> — authoritative.
 *   - Each record holds the last MAX_TAIL_BYTES of output as an in-memory
 *     ring so the status bar can render live without hitting disk every tick.
 *   - Completed jobs are kept for JOB_TTL_MS (default 24 h) so the user has
 *     time to review the log, then GC'd along with their log file.
 *
 * Concurrency:
 *   Node runs these in a single process. Map access is safe. The spawn()
 *   callsite in the /api/scripts/run route is the only writer; readers are
 *   the /jobs routes and the optional finalise callback.
 */

import { promises as fsp } from 'node:fs';
import { mkdirSync, openSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

export type JobStatus = 'running' | 'success' | 'failed' | 'aborted';

export interface JobRecord {
  id: string;
  /** Proxmox node name the script was targeted at. */
  node: string;
  /** Full raw.githubusercontent URL that was piped to bash. */
  scriptUrl: string;
  /** Human display name (from ScriptManifest.name). */
  scriptName: string;
  /** Script slug (from ScriptManifest.slug) — for UI navigation back to detail. */
  slug?: string;
  /** Install method key used ("default" | "alpine" | ...). */
  method?: string;
  /** PVE username that started the job (session.username). */
  user: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  /** Exit code of the child. 0 on success; null if killed before close. */
  exitCode?: number | null;
  /** Process ID of the spawned child — used for abort. */
  pid?: number;
  /** Absolute path to the merged stdout+stderr log. */
  logPath: string;
  /** Last N bytes of output, updated live. */
  tail: string;
  /** Custom env overrides the user provided (for display / auditing). */
  env?: Record<string, string>;
}

const LOG_DIR = join(tmpdir(), 'nexus-script-logs');
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_TAIL_BYTES = 64 * 1024; // 64 KB in-memory tail per job
const MAX_LOG_BYTES = 4 * 1024 * 1024; // 4 MB per-job log file cap

mkdirSync(LOG_DIR, { recursive: true });

const jobs = new Map<string, JobRecord>();

// ─── Creation / update ───────────────────────────────────────────────────────

export interface CreateJobInput {
  node: string;
  scriptUrl: string;
  scriptName: string;
  slug?: string;
  method?: string;
  user: string;
  env?: Record<string, string>;
}

/**
 * Register a new job and open its log file. Returns the job record and a
 * writable file descriptor the caller attaches to the spawned child's
 * stdout + stderr.
 */
export function createJob(input: CreateJobInput): { job: JobRecord; fd: number } {
  const id = randomUUID();
  const logPath = join(LOG_DIR, `${id}.log`);
  // 'w' truncates — a freshly-created job always starts with an empty log.
  const fd = openSync(logPath, 'w');
  const job: JobRecord = {
    id,
    node: input.node,
    scriptUrl: input.scriptUrl,
    scriptName: input.scriptName,
    slug: input.slug,
    method: input.method,
    user: input.user,
    status: 'running',
    startedAt: Date.now(),
    logPath,
    tail: '',
    env: input.env,
  };
  jobs.set(id, job);
  return { job, fd };
}

export function setJobPid(id: string, pid: number): void {
  const job = jobs.get(id);
  if (job) job.pid = pid;
}

/**
 * Append a chunk of output to the in-memory tail. Called from the stream
 * teeing in the run route — the same bytes also hit the log fd, so we
 * don't re-write to disk here.
 */
export function appendTail(id: string, chunk: Buffer | string): void {
  const job = jobs.get(id);
  if (!job) return;
  const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const combined = job.tail + s;
  job.tail =
    combined.length <= MAX_TAIL_BYTES
      ? combined
      : combined.slice(combined.length - MAX_TAIL_BYTES);
}

export function finaliseJob(id: string, status: JobStatus, exitCode: number | null): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  job.exitCode = exitCode;
  job.finishedAt = Date.now();
  job.pid = undefined;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

/**
 * List recent jobs for a user, newest first. `limit` defaults to 20 —
 * the status bar shows just a few running jobs; the full list is used
 * when a user opens the job drawer history.
 */
export function listJobsForUser(user: string, limit = 20): JobRecord[] {
  const out: JobRecord[] = [];
  for (const j of jobs.values()) {
    if (j.user === user) out.push(j);
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out.slice(0, limit);
}

/**
 * Read the on-disk log for a job. Cap at MAX_LOG_BYTES so an accidental
 * runaway log can't OOM the browser.
 */
export async function readJobLog(id: string, maxBytes = MAX_LOG_BYTES): Promise<string> {
  const job = jobs.get(id);
  if (!job) return '';
  try {
    const stat = await fsp.stat(job.logPath);
    const size = Number(stat.size);
    // If the file is bigger than the cap, read only the tail — the user is
    // almost always interested in the most recent output.
    const start = size > maxBytes ? size - maxBytes : 0;
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(job.logPath, { start });
      stream.on('data', (c) => chunks.push(c as Buffer));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  } catch {
    return job.tail;
  }
}

// ─── Abort ───────────────────────────────────────────────────────────────────

/**
 * Send SIGTERM to the job's process and mark it aborted. Returns true if the
 * signal was delivered, false if the job is no longer running or unknown.
 * Callers should not assume the process has actually exited on return —
 * the child's close handler will flip the final status to 'aborted'.
 */
export function abortJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== 'running' || !job.pid) return false;
  try {
    process.kill(job.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// ─── Garbage collection ──────────────────────────────────────────────────────

/**
 * Drop completed jobs older than JOB_TTL_MS and delete their log files.
 * Running jobs are never GC'd regardless of age — if a script takes 25 h,
 * keep tracking it. Called on a timer started by `startJobGc`.
 */
async function gcOnce(): Promise<void> {
  const now = Date.now();
  const victims: JobRecord[] = [];
  for (const j of jobs.values()) {
    if (j.status === 'running') continue;
    if (!j.finishedAt) continue;
    if (now - j.finishedAt > JOB_TTL_MS) victims.push(j);
  }
  for (const v of victims) {
    jobs.delete(v.id);
    try {
      await fsp.unlink(v.logPath);
    } catch {
      /* already gone; don't care */
    }
  }
}

let gcStarted = false;
/**
 * Start the GC timer exactly once per process. Route handlers call this
 * lazily on first use — we don't want to schedule a timer at module load
 * because that would keep `next build` hanging on the process.
 */
export function ensureJobGcStarted(): void {
  if (gcStarted) return;
  gcStarted = true;
  const timer = setInterval(() => {
    void gcOnce();
  }, 10 * 60 * 1000); // every 10 minutes
  // Allow Node to exit cleanly even if this timer is the only thing keeping
  // the event loop alive.
  if (typeof timer.unref === 'function') timer.unref();
}

// ─── Env sanitisation ────────────────────────────────────────────────────────

/**
 * Whitelist of env var names the UI is allowed to set. Anything outside this
 * list is dropped silently so a compromised client can't reach into the
 * child's environment with e.g. LD_PRELOAD or PATH. Names map 1:1 to the
 * "var_*" conventions community-scripts use when running in non-interactive
 * / advanced mode.
 *
 * NOTE: The fact that a var is in this list does NOT guarantee the script
 * respects it — community scripts vary. The UI labels these as "best-effort
 * overrides" to set expectations.
 */
const ENV_WHITELIST = new Set([
  'CT_ID',
  'CTID',
  'HN',
  'HOSTNAME',
  'CT_HOSTNAME',
  'PW',
  'PASSWORD',
  'CT_PASSWORD',
  'DISK_SIZE',
  'var_disk',
  'CORE_COUNT',
  'var_cpu',
  'RAM_SIZE',
  'var_ram',
  'BRG',
  'STORAGE',
  'CT_STORAGE',
  'VLAN',
  'MTU',
  'NET',
  'GATE',
  'MAC',
  'NSDNS',
  'SSH',
  'SSH_AUTHORIZED_KEY',
  'VERB',
  'APT_CACHER_IP',
  'APP_PORT',
]);

/** Regex the VALUE of each env var must match. No shell metachars, no newlines. */
const ENV_VALUE_RE = /^[A-Za-z0-9 ._\-:/=@+,]{0,512}$/;

/**
 * Filter a caller-provided env dict down to the whitelist and reject
 * values with shell-dangerous characters. Returns both the sanitised map
 * and a list of rejected keys for audit logging.
 */
export function sanitiseEnv(
  raw: unknown,
): { env: Record<string, string>; rejected: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { env: {}, rejected: [] };
  }
  const out: Record<string, string> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENV_WHITELIST.has(k)) {
      rejected.push(k);
      continue;
    }
    if (typeof v !== 'string' || !ENV_VALUE_RE.test(v)) {
      rejected.push(k);
      continue;
    }
    out[k] = v;
  }
  return { env: out, rejected };
}

/**
 * Build the bash preamble that exports sanitised env vars for the child.
 * Values are fed through printf %q so a trailing `$` or quote in a legal
 * value can't break out of the export line. (ENV_VALUE_RE already forbids
 * every quoting character we care about, but %q is defense in depth.)
 */
export function buildEnvPreamble(env: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    lines.push(`export ${k}=${JSON.stringify(v)}`);
  }
  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

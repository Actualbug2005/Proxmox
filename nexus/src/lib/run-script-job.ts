/**
 * Shared community-script runner.
 *
 * Both /api/scripts/run (manual) and the scheduler tick go through this
 * module so:
 *   - The spawn semantics (detached, stdin-piped, tee'd log) stay identical.
 *   - Audit logging is mandatory for every fire (both paths).
 *   - Future behavioural changes land in one place.
 *
 * Auth, CSRF, PVE ACLs, and rate limiting are the CALLER's responsibility —
 * they're orthogonal to spawn/audit and differ between HTTP requests and the
 * background tick. What this module owns is: input re-validation (defense in
 * depth — the scheduler may hold a scriptUrl from before an allow-list
 * change), job-registry bookkeeping, the ssh|bash pipeline, and audit.
 */

import { spawn } from 'node:child_process';
import { closeSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';

// Explicit .ts extensions — this module is reached from server.ts which
// runs under Node's --experimental-strip-types (no bundler resolver).
import { writeAuditEntry, noteAuditWriteFailure } from './exec-audit.ts';
import { resolveNodeAddress } from './remote-shell.ts';
import {
  appendTail,
  buildEnvPreamble,
  createJob,
  ensureJobGcStarted,
  finaliseJob,
  sanitiseEnv,
  setJobPid,
} from './script-jobs.ts';

// ─── Validation primitives ──────────────────────────────────────────────────

export const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;
export const TRUSTED_ORIGINS = new Set<string>([
  'https://raw.githubusercontent.com',
]);
export const SCRIPT_PATH_RE = /^\/community-scripts\/ProxmoxVE\/[A-Za-z0-9._\-/]+$/;

/**
 * Structured error for bad inputs. The route handler maps `.status` straight
 * onto the HTTP response; the scheduler just logs.
 */
export class RunScriptJobError extends Error {
  // Explicit fields instead of TS parameter properties — Node's strip-only
  // mode (--experimental-strip-types) rejects the shorthand.
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RunScriptJobError';
    this.status = status;
    this.code = code;
  }
}

function badRequest(code: string, message: string): never {
  throw new RunScriptJobError(400, code, message);
}

export function validateNodeName(node: unknown): string {
  if (typeof node !== 'string' || !NODE_RE.test(node)) {
    badRequest('invalid_node', 'Invalid node name');
  }
  return node;
}

/** Returns the parsed URL — callers that re-stringify should use `.toString()`. */
export function validateScriptUrl(scriptUrl: unknown): URL {
  if (typeof scriptUrl !== 'string') badRequest('invalid_url', 'scriptUrl is required');
  let parsed: URL;
  try {
    parsed = new URL(scriptUrl);
  } catch {
    badRequest('invalid_url', 'Malformed script URL');
  }
  if (!TRUSTED_ORIGINS.has(parsed.origin)) {
    badRequest('untrusted_origin', 'Untrusted script origin');
  }
  if (!SCRIPT_PATH_RE.test(parsed.pathname) || parsed.search || parsed.hash) {
    badRequest('untrusted_path', 'Untrusted script path');
  }
  return parsed;
}

// ─── Spawn + tee ────────────────────────────────────────────────────────────

interface SpawnDetachedParams {
  jobId: string;
  node: string;
  address: string;
  scriptUrl: string;
  envPreamble: string;
  timeoutMs: number;
  logFd: number;
  onClose: (status: 'success' | 'failed' | 'aborted', exitCode: number | null) => void;
}

/**
 * Spawn the ssh|bash pipeline detached and wire its output to both the job's
 * log file (via the inherited fd) and the in-memory tail (for live status-
 * bar rendering). Lifted verbatim from the original route handler so the
 * exec semantics are unchanged.
 */
function spawnDetached(params: SpawnDetachedParams): { pid: number | undefined } {
  const { jobId, node, address, scriptUrl, envPreamble, timeoutMs, logFd, onClose } = params;

  const isLocal = node === hostname();
  const file = isLocal ? 'bash' : 'ssh';
  const args = isLocal
    ? ['-s']
    : [
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        `root@${address}`,
        'bash', '-s',
      ];

  const controller = new AbortController();
  let timedOut = false;
  const softKillTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let hardKillTimer: NodeJS.Timeout | null = null;

  const child = spawn(file, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: controller.signal,
  });

  const tee = (chunk: Buffer) => {
    try {
      // Sync write keeps log ordering deterministic (stdout and stderr pipe
      // events interleave via the event loop; async writes could reorder
      // them relative to the appendTail call below).
      writeSync(logFd, chunk);
    } catch {
      /* fd might be closed on abort — drop the write, not fatal */
    }
    appendTail(jobId, chunk);
  };

  child.stdout?.on('data', tee);
  child.stderr?.on('data', tee);

  controller.signal.addEventListener('abort', () => {
    hardKillTimer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 5_000);
  });

  child.on('error', (err) => {
    tee(Buffer.from(`\n[nexus] spawn error: ${err.message}\n`, 'utf8'));
    cleanup();
    onClose('failed', null);
  });

  child.on('close', (code, signal) => {
    cleanup();
    if (timedOut) {
      tee(Buffer.from(`\n[nexus] timed out after ${timeoutMs}ms\n`, 'utf8'));
      onClose('failed', code);
    } else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      tee(Buffer.from(`\n[nexus] aborted by user (${signal})\n`, 'utf8'));
      onClose('aborted', code);
    } else if (code === 0) {
      onClose('success', 0);
    } else {
      onClose('failed', code);
    }
  });

  function cleanup() {
    clearTimeout(softKillTimer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    try {
      closeSync(logFd);
    } catch {
      /* already closed */
    }
  }

  const curlMaxTimeSec = Math.ceil(timeoutMs / 1000);
  child.stdin?.end(
    `set -euo pipefail\n` +
    `export TERM=xterm-256color\n` +
    `export COLUMNS=\${COLUMNS:-120}\n` +
    `export LINES=\${LINES:-40}\n` +
    `export mode=default\n` +
    `export PHS_SILENT=1\n` +
    envPreamble +
    `SCRIPT_URL=${JSON.stringify(scriptUrl)}\n` +
    `curl -fsSL --proto '=https' --proto-redir '=https' --max-redirs 3 --max-time ${curlMaxTimeSec} -- "$SCRIPT_URL" | bash\n`,
  );

  return { pid: child.pid };
}

// ─── Public entry ───────────────────────────────────────────────────────────

export interface RunScriptJobInput {
  /** PVE userid — used for audit + job-registry ownership. */
  user: string;
  node: string;
  /** MUST pass validateScriptUrl. Passed through re-validation here as defense in depth. */
  scriptUrl: string;
  scriptName: string;
  slug?: string;
  method?: string;
  /**
   * Raw env from the caller. Passed through sanitiseEnv here so both the
   * manual route and the scheduler get the same allow-list treatment.
   */
  env?: Record<string, unknown>;
  timeoutMs: number;
  /**
   * Optional post-close hook. /api/scripts/run uses it to release the
   * concurrency slot before audit; the scheduler does not set it.
   */
  onClose?: (status: 'success' | 'failed' | 'aborted', exitCode: number | null) => Promise<void>;
}

export interface RunScriptJobResult {
  jobId: string;
  startedAt: number;
  rejectedEnvKeys: string[];
}

/**
 * Start a detached script run. Returns as soon as the child is spawned —
 * the returned jobId is immediately queryable via /api/scripts/jobs/[id].
 *
 * Throws RunScriptJobError on validation failure (callers translate to 400
 * for HTTP contexts, or log-and-skip for the scheduler).
 */
export async function runScriptJob(input: RunScriptJobInput): Promise<RunScriptJobResult> {
  ensureJobGcStarted();

  const node = validateNodeName(input.node);
  const parsedUrl = validateScriptUrl(input.scriptUrl);

  const { env: safeEnv, rejected } = sanitiseEnv(input.env ?? {});
  const envPreamble = buildEnvPreamble(safeEnv);

  // Pre-resolve the address so a /etc/pve/.members error fails before we
  // create a job row (avoids empty 'failed' ghosts for trivial input bugs).
  const address = await resolveNodeAddress(node);

  const { job, fd } = createJob({
    node,
    scriptUrl: parsedUrl.toString(),
    scriptName: input.scriptName || parsedUrl.pathname.split('/').pop() || 'script',
    slug: input.slug && input.slug.length <= 63 ? input.slug : undefined,
    method: input.method && input.method.length <= 32 ? input.method : undefined,
    user: input.user,
    env: safeEnv,
  });

  const started = Date.now();
  const { pid } = spawnDetached({
    jobId: job.id,
    node,
    address,
    scriptUrl: parsedUrl.toString(),
    envPreamble,
    timeoutMs: input.timeoutMs,
    logFd: fd,
    onClose: async (status, exitCode) => {
      finaliseJob(job.id, status, exitCode);
      // Caller hook first — keeps slot-release ahead of audit so a slow
      // audit write doesn't hold a user's concurrency budget.
      if (input.onClose) {
        try {
          await input.onClose(status, exitCode);
        } catch (err) {
          console.error('[run-script-job] caller onClose failed:', {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      try {
        await writeAuditEntry({
          user: input.user,
          node,
          endpoint: 'scripts.run',
          command: parsedUrl.toString(),
          exitCode: exitCode ?? 1,
          durationMs: Date.now() - started,
        });
      } catch (err) {
        // H1: structured event + counter. Keep the jobId hint in a tail
        // line so a grep starting from the event name still ties back to
        // a specific job.
        noteAuditWriteFailure('scripts.run', input.user, err);
        console.error('[run-script-job] audit write failed for jobId=%s', job.id);
      }
    },
  });
  if (pid !== undefined) setJobPid(job.id, pid);

  return {
    jobId: job.id,
    startedAt: job.startedAt,
    rejectedEnvKeys: rejected,
  };
}

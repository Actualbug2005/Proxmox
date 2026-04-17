/**
 * POST /api/scripts/run — fire-and-forget community-script executor.
 *
 * Response model (changed 2026-04-17):
 *   Previously this handler *awaited* the child process for up to 15 min, so
 *   edge proxies with short response timeouts (Cloudflare Tunnel: 100 s)
 *   returned 502 long before most community scripts finished. The handler
 *   now spawns the child detached, records a job in the script-jobs
 *   registry, and returns 200 with { jobId } immediately. Clients poll
 *   /api/scripts/jobs/[jobId] for status + log.
 *
 * Security mechanism (unchanged):
 *   1. URL is parsed with the WHATWG URL constructor and matched against an
 *      origin + pathname whitelist — the pathname is restricted to
 *      characters that cannot break out of a single-quoted shell context.
 *   2. Caller must hold Sys.Modify on /nodes/<node> via the PVE ACL.
 *   3. CSRF double-submit header is validated before any work happens.
 *   4. The script URL is piped to bash over stdin via spawn(ssh, ..., bash -s)
 *      so the URL never appears in the remote argv either.
 *
 * New: env overrides
 *   Clients may supply `env: Record<string,string>` with hostname / storage /
 *   cpu etc. overrides. Names are filtered through an allow-list and values
 *   through a strict regex; anything else is silently dropped. Accepted
 *   vars become `export K=V` lines in the bash preamble.
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { closeSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { requireNodeSysModify } from '@/lib/permissions';
import { EXEC_LIMITS } from '@/lib/exec-policy';
import { RATE_LIMITS, acquireSlot, takeToken } from '@/lib/rate-limit';
import { writeAuditEntry } from '@/lib/exec-audit';
import {
  appendTail,
  buildEnvPreamble,
  createJob,
  ensureJobGcStarted,
  finaliseJob,
  sanitiseEnv,
  setJobPid,
} from '@/lib/script-jobs';

const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;
// Only the raw-content CDN is trusted. See README.md §Script-execution trust
// boundary for why github.com is not in this set.
const TRUSTED_ORIGINS = new Set([
  'https://raw.githubusercontent.com',
]);
const SCRIPT_PATH_RE = /^\/community-scripts\/ProxmoxVE\/[A-Za-z0-9._\-/]+$/;

interface PVEMembers {
  nodelist?: Record<string, { ip?: string; online?: number }>;
}

async function resolveNodeAddress(node: string): Promise<string> {
  try {
    const raw = await readFile('/etc/pve/.members', 'utf8');
    const parsed = JSON.parse(raw) as PVEMembers;
    const ip = parsed.nodelist?.[node]?.ip;
    if (ip) return ip;
  } catch {
    /* standalone PVE — fall through to the node name */
  }
  return node;
}

/**
 * Spawn the ssh|bash pipeline detached and wire its output to both the
 * job's log file (via the inherited fd) and the in-memory tail (for live
 * status-bar rendering). The slot releaser / audit-writer is invoked
 * asynchronously when the child finally closes — the POST handler has
 * long since returned by then.
 */
function spawnDetached(params: {
  jobId: string;
  node: string;
  address: string;
  scriptUrl: string;
  envPreamble: string;
  timeoutMs: number;
  logFd: number;
  onClose: (status: 'success' | 'failed' | 'aborted', exitCode: number | null) => void;
}): { pid: number | undefined } {
  const {
    jobId,
    node,
    address,
    scriptUrl,
    envPreamble,
    timeoutMs,
    logFd,
    onClose,
  } = params;

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

  // stdio: [stdin=pipe, stdout=logFd, stderr=logFd] so every byte the child
  // writes lands in the log file directly — we still want to mirror into
  // the ring buffer for the status bar, so we open a second pipe below.
  //
  // Actually we can't do both at once with child_process on a single fd:
  // using pipe means we read from Node, using the fd means we don't. We
  // use two pipes (stdout + stderr), then tee each chunk to:
  //   - fs.write(logFd, chunk)       — durable log
  //   - appendTail(jobId, chunk)     — ephemeral ring for UI
  const child = spawn(file, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: controller.signal,
  });

  // The logFd is ours to own — close it when the child exits.
  const tee = (chunk: Buffer) => {
    try {
      // Sync write keeps log ordering deterministic (stdout and stderr
      // pipe events interleave via the event loop; async writes could
      // reorder them relative to the appendTail call below).
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
  // The URL is passed to bash via stdin — it never touches an argv slot or
  // a shell string literal. $SCRIPT_URL below is a bash variable.
  //
  // Terminal environment:
  //   Community scripts call `clear` / `tput` / whiptail inside
  //   misc/build.func. Without a TTY AND without TERM set, `clear`
  //   exits non-zero ("TERM environment variable not set"), which the
  //   script's ERR trap surfaces as a line-876 fatal. Setting TERM to a
  //   known terminfo entry gives `clear` a definition to resolve; the
  //   COLUMNS/LINES defaults keep whiptail from computing a 0x0 window
  //   when it manages to run. None of this creates a real TTY —
  //   anything that truly needs isatty() (whiptail's "advanced" mode)
  //   will still fail, but the default non-interactive path works.
  // Non-interactive dispatch:
  //   mode=default       — read by misc/build.func's install_script() to
  //                        skip the whiptail "Default / Advanced / …" menu
  //                        and take the default path. Without this, the
  //                        whiptail prompt opens, sees no TTY, and the
  //                        script cleanly exits via exit_script() (exit 0,
  //                        but nothing was actually installed).
  //   PHS_SILENT=1       — the same skip flag for the post-install
  //                        "Update/Settings" menu build.func's start()
  //                        shows when re-run inside a container. Harmless
  //                        on a fresh install; useful on reruns.
  //   var_* overrides    — build.func's base_settings() / update_script()
  //                        read these to pick hostname, CT ID, CPU, RAM,
  //                        disk size, etc. Supplied by the UI's
  //                        "Advanced configuration" panel and filtered
  //                        through sanitiseEnv() before we interpolate.
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

export async function POST(req: NextRequest) {
  ensureJobGcStarted();

  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as {
    node?: string;
    scriptUrl?: string;
    scriptName?: string;
    slug?: string;
    method?: string;
    env?: Record<string, unknown>;
    timeoutMs?: number;
  };
  const { node, scriptUrl, scriptName, slug, method, env: rawEnv, timeoutMs: rawTimeoutMs } = body;

  if (!node || !scriptUrl || typeof node !== 'string' || typeof scriptUrl !== 'string') {
    return NextResponse.json({ error: 'node and scriptUrl are required' }, { status: 400 });
  }
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid node name' }, { status: 400 });
  }

  const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
  const timeoutMs =
    typeof rawTimeoutMs === 'number' && Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
      ? Math.min(rawTimeoutMs, EXEC_LIMITS.maxTimeoutMs)
      : DEFAULT_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(scriptUrl);
  } catch {
    return NextResponse.json({ error: 'Malformed script URL' }, { status: 400 });
  }
  if (!TRUSTED_ORIGINS.has(parsed.origin)) {
    return NextResponse.json({ error: 'Untrusted script origin' }, { status: 400 });
  }
  if (!SCRIPT_PATH_RE.test(parsed.pathname) || parsed.search || parsed.hash) {
    return NextResponse.json({ error: 'Untrusted script path' }, { status: 400 });
  }

  if (!(await requireNodeSysModify(session, node))) {
    return NextResponse.json(
      { error: 'Forbidden: Sys.Modify required on /nodes/' + node },
      { status: 403 },
    );
  }

  const token = await takeToken(
    sessionId,
    'scripts.run',
    RATE_LIMITS.scriptsRun.limit,
    RATE_LIMITS.scriptsRun.windowMs,
  );
  if (!token.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterMs: token.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((token.retryAfterMs ?? 0) / 1000)) } },
    );
  }

  const slot = await acquireSlot(
    sessionId,
    'scripts.run',
    RATE_LIMITS.scriptsRun.maxConcurrent,
    EXEC_LIMITS.maxTimeoutMs + 60_000,
  );
  if (!slot) {
    return NextResponse.json(
      { error: `Concurrency limit reached (max ${RATE_LIMITS.scriptsRun.maxConcurrent} in flight per session)` },
      { status: 429 },
    );
  }

  const { env: safeEnv, rejected } = sanitiseEnv(rawEnv);
  const envPreamble = buildEnvPreamble(safeEnv);

  // Pre-resolve node address so a DNS/members error fails fast BEFORE we
  // register a job (no empty 'failed' ghost records from trivial input bugs).
  const address = await resolveNodeAddress(node);

  const { job, fd } = createJob({
    node,
    scriptUrl: parsed.toString(),
    scriptName: typeof scriptName === 'string' ? scriptName : parsed.pathname.split('/').pop() ?? 'script',
    slug: typeof slug === 'string' && slug.length <= 63 ? slug : undefined,
    method: typeof method === 'string' && method.length <= 32 ? method : undefined,
    user: session.username,
    env: safeEnv,
  });

  const started = Date.now();
  const { pid } = spawnDetached({
    jobId: job.id,
    node,
    address,
    scriptUrl: parsed.toString(),
    envPreamble,
    timeoutMs,
    logFd: fd,
    onClose: async (status, exitCode) => {
      finaliseJob(job.id, status, exitCode);
      // Release concurrency slot first so an audit-write hang doesn't
      // deadlock the user's budget. Audit writes are best-effort.
      await slot.release();
      try {
        await writeAuditEntry({
          user: session.username,
          node,
          endpoint: 'scripts.run',
          command: parsed.toString(),
          exitCode: exitCode ?? 1,
          durationMs: Date.now() - started,
        });
      } catch (auditErr) {
        console.error('[api/scripts/run] audit write failed:', auditErr);
      }
    },
  });
  if (pid !== undefined) setJobPid(job.id, pid);

  return NextResponse.json({
    jobId: job.id,
    startedAt: job.startedAt,
    rejectedEnvKeys: rejected,
  });
}

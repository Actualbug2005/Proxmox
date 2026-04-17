/**
 * Execute a community script on a Proxmox node via ssh to root@<node>.
 *
 * Security mechanism:
 *   1. URL is parsed with the WHATWG URL constructor and matched against an
 *      origin + pathname whitelist — the pathname is restricted to characters
 *      that cannot break out of a single-quoted shell context, so string
 *      interpolation into the command cannot inject.
 *   2. Caller must hold Sys.Modify on /nodes/<node> via the PVE ACL.
 *   3. CSRF double-submit header is validated before any work happens.
 *   4. The script URL is piped to bash over stdin via spawn(ssh, ..., bash -s)
 *      so the URL never appears in the remote argv either.
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { requireNodeSysModify } from '@/lib/permissions';
import { EXEC_LIMITS } from '@/lib/exec-policy';
import { RATE_LIMITS, acquireSlot, takeToken } from '@/lib/rate-limit';
import { writeAuditEntry } from '@/lib/exec-audit';

// PVE's self-signed cert is handled inside pveFetch (used by permissions.ts).
// No process-global NODE_TLS_REJECT_UNAUTHORIZED mutation — it leaked TLS
// verification off for every outbound fetch in the Node runtime.

const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;
// Only the raw-content CDN is trusted. github.com was removed because its
// /raw/ paths 302 to raw.githubusercontent.com AND repo owners can
// configure arbitrary redirects — combined with curl's default redirect-
// following behaviour, that gave an attacker controlling any mirror in a
// redirect chain root RCE on every PVE node. See the hardened curl
// invocation in pipeScriptToRemoteBash for belt-and-braces.
const TRUSTED_ORIGINS = new Set([
  'https://raw.githubusercontent.com',
]);
// Paths must belong to the community-scripts/ProxmoxVE repo and contain only
// the shell-safe character set — letters, digits, dot, dash, underscore, slash.
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

function pipeScriptToRemoteBash(
  node: string,
  address: string,
  scriptUrl: string,
  timeoutMs: number,
): Promise<{ upid: string }> {
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

  return new Promise((resolve, reject) => {
    // H8 — timeout enforcement.
    // AbortController ties the timer to the child: when the signal aborts,
    // Node sends SIGTERM to the child. We keep a separate hard-kill timer
    // that escalates to SIGKILL 5s later in case the remote hangs in a
    // state where SIGTERM doesn't free the process (e.g., stuck SSH handshake).
    const controller = new AbortController();
    const softKillTimer = setTimeout(() => controller.abort(), timeoutMs);
    let hardKillTimer: NodeJS.Timeout | null = null;

    const child = spawn(file, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      signal: controller.signal,
    });

    let stderr = '';
    let timedOut = false;

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });

    controller.signal.addEventListener('abort', () => {
      timedOut = true;
      hardKillTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5_000);
    });

    const cleanup = () => {
      clearTimeout(softKillTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
    };

    child.on('error', (err) => {
      cleanup();
      // AbortError fires when we kill the child via the controller. Surface
      // it as a user-meaningful timeout rather than a generic error.
      if (timedOut) {
        reject(new Error(`Script timed out after ${timeoutMs}ms`));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      cleanup();
      if (timedOut) {
        reject(new Error(`Script timed out after ${timeoutMs}ms`));
      } else if (code === 0) {
        resolve({ upid: `nexus-script:${Date.now()}` });
      } else {
        reject(new Error(`script failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });

    // The URL is passed to bash via stdin — it never touches an argv slot or
    // a shell string literal. `$SCRIPT_URL` below is a bash variable, not an
    // interpolation site.
    //
    // curl flags hardened per audit C3:
    //   --proto '=https'         reject any non-HTTPS URL outright
    //   --proto-redir '=https'   reject any redirect that would leave HTTPS
    //                            (blocks http://, ftp://, file://, gopher://
    //                             redirect-downgrades)
    //   --max-redirs 3           cap redirect chain so an attacker-controlled
    //                            mirror can't chain through metadata services
    //                            or loop the request into a timing oracle
    //   --max-time in curl itself is also bounded via timeoutMs above as a
    //   belt-and-braces second layer — the AbortController covers the parent
    //   process side, curl's own timeout covers the network side.
    const curlMaxTimeSec = Math.ceil(timeoutMs / 1000);
    child.stdin.end(
      `set -euo pipefail\n` +
      `SCRIPT_URL=${JSON.stringify(scriptUrl)}\n` +
      `curl -fsSL --proto '=https' --proto-redir '=https' --max-redirs 3 --max-time ${curlMaxTimeSec} -- "$SCRIPT_URL" | bash\n`,
    );
  });
}

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { node, scriptUrl, scriptName, timeoutMs: rawTimeoutMs } = (await req.json()) as {
    node?: string;
    scriptUrl?: string;
    scriptName?: string;
    timeoutMs?: number;
  };

  if (!node || !scriptUrl || typeof node !== 'string' || typeof scriptUrl !== 'string') {
    return NextResponse.json({ error: 'node and scriptUrl are required' }, { status: 400 });
  }
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid node name' }, { status: 400 });
  }

  // H8 — clamp caller-provided timeout to the policy ceiling. Default 15 min
  // is enough for every community script we've seen; ceiling at 45 min
  // matches EXEC_LIMITS.maxTimeoutMs for operational parity with /api/exec.
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

  // Rate limit BEFORE slot acquisition — 429 on token refusal is cheap.
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

  const started = Date.now();
  let exitCode: number | null = null;
  try {
    const address = await resolveNodeAddress(node);
    const { upid } = await pipeScriptToRemoteBash(node, address, parsed.toString(), timeoutMs);
    exitCode = 0;
    return NextResponse.json({ upid, node, scriptName: scriptName ?? null });
  } catch (err) {
    exitCode = 1;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  } finally {
    // Release concurrency slot first so an audit-write hang doesn't deadlock
    // the user's budget. Audit writes are best-effort — log but never bubble
    // up to the caller.
    await slot.release();
    try {
      await writeAuditEntry({
        user: session.username,
        node,
        endpoint: 'scripts.run',
        // Log the script URL as the "command" — that's what identifies what
        // actually ran on the target node (the URL is the input to curl|bash).
        command: parsed.toString(),
        exitCode,
        durationMs: Date.now() - started,
      });
    } catch (auditErr) {
      console.error('[api/scripts/run] audit write failed:', auditErr);
    }
  }
}

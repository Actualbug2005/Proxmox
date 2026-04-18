/**
 * Cluster-wide shell executor.
 *
 * Auth + policy chain:
 *   1. Valid Nexus session cookie
 *   2. Matching X-Nexus-CSRF header (double-submit)
 *   3. Caller holds Sys.Modify on /nodes/<targetNode> via the PVE ACL
 *   4. Per-session rate limit (token bucket) — rejects 429 if exceeded
 *   5. Per-session concurrency cap (semaphore) — rejects 429 if at cap
 *   6. Command length + caller-provided timeout clamped to EXEC_LIMITS
 *
 * Audit:
 *   Every invocation appends to the asymmetric hybrid audit log:
 *   SAFE tier (ts/user/node/cmd_hash/exit/duration) at /var/log/nexus/exec.jsonl
 *   SECRET tier (RSA-OAEP + AES-GCM envelope-encrypted cmd) at exec-commands.enc.jsonl
 *   See src/lib/exec-audit.ts for the decrypt procedure.
 *
 * The command payload is piped over stdin — it never touches argv, so no
 * amount of shell metacharacters in it can affect how ssh/bash itself is
 * invoked.
 */
import { NextResponse } from 'next/server';
import { hostname } from 'node:os';
import { withCsrf } from '@/lib/route-middleware';
import { requireNodeSysModify } from '@/lib/permissions';
import { NODE_RE, runScriptOnNode } from '@/lib/remote-shell';
import { EXEC_LIMITS } from '@/lib/exec-policy';
import { RATE_LIMITS, acquireSlot, takeToken } from '@/lib/rate-limit';
import { writeAuditEntry, noteAuditWriteFailure } from '@/lib/exec-audit';

interface ExecRequest {
  command: string;
  node?: string;
  timeoutMs?: number;
}

export const POST = withCsrf(async (req, { session, sessionId }) => {
  const body = (await req.json()) as ExecRequest;
  if (!body?.command || typeof body.command !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid "command"' }, { status: 400 });
  }

  // 64 KB hard cap on command length (EXEC_LIMITS.maxCommandBytes).
  const cmdBytes = Buffer.byteLength(body.command, 'utf8');
  if (cmdBytes > EXEC_LIMITS.maxCommandBytes) {
    return NextResponse.json(
      { error: `Command too large: ${cmdBytes} bytes (max ${EXEC_LIMITS.maxCommandBytes})` },
      { status: 413 },
    );
  }

  // Clamp caller-provided timeout to EXEC_LIMITS.maxTimeoutMs. Without the
  // clamp, a user with Sys.Modify could park a 10-hour job and hold a slot
  // until the infra collapses.
  const timeoutMs = Math.min(
    typeof body.timeoutMs === 'number' && body.timeoutMs > 0
      ? body.timeoutMs
      : EXEC_LIMITS.maxTimeoutMs,
    EXEC_LIMITS.maxTimeoutMs,
  );

  const localHost = hostname();
  const targetNode = body.node && body.node !== localHost ? body.node : localHost;

  if (!NODE_RE.test(targetNode)) {
    return NextResponse.json({ error: `Invalid node name: ${targetNode}` }, { status: 400 });
  }

  if (!(await requireNodeSysModify(session, targetNode))) {
    return NextResponse.json(
      { error: 'Forbidden: Sys.Modify required on /nodes/' + targetNode },
      { status: 403 },
    );
  }

  // Rate limit BEFORE concurrency — a 429 here is cheap, a leaked slot is not.
  const token = await takeToken(sessionId, 'exec', RATE_LIMITS.exec.limit, RATE_LIMITS.exec.windowMs);
  if (!token.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterMs: token.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((token.retryAfterMs ?? 0) / 1000)) } },
    );
  }

  // Concurrency slot (release in finally). TTL is maxTimeoutMs + 60s so a
  // crashed handler can't leave the slot reserved longer than the worst
  // legitimate execution window.
  const slot = await acquireSlot(
    sessionId,
    'exec',
    RATE_LIMITS.exec.maxConcurrent,
    EXEC_LIMITS.maxTimeoutMs + 60_000,
  );
  if (!slot) {
    return NextResponse.json(
      { error: `Concurrency limit reached (max ${RATE_LIMITS.exec.maxConcurrent} in flight per session)` },
      { status: 429 },
    );
  }

  const started = Date.now();
  let exitCode: number | null = null;
  try {
    const result = await runScriptOnNode(targetNode, body.command, { timeoutMs });
    exitCode = result.exitCode;
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  } finally {
    // Release slot first so a hang in audit writing doesn't deadlock the
    // user's budget. Audit is best-effort — we log but don't bubble up
    // audit failures to the caller.
    await slot.release();
    try {
      await writeAuditEntry({
        user: session.username,
        node: targetNode,
        endpoint: 'exec',
        command: body.command,
        exitCode,
        durationMs: Date.now() - started,
      });
    } catch (auditErr) {
      noteAuditWriteFailure('exec', session.username, auditErr);
    }
  }
});

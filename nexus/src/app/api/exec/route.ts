/**
 * Local + cluster-wide shell executor.
 *
 * - If `node` matches this host's hostname, runs locally via bash.
 * - Otherwise SSHes to `root@{node}` — relies on PVE's cluster-wide SSH trust
 *   (pvecm adds each member's key to /etc/ssh/ssh_known_hosts and authorized_keys).
 *
 * Auth:
 *   1. Valid Nexus session cookie
 *   2. Matching X-Nexus-CSRF header (double-submit)
 *   3. Caller holds Sys.Modify on /nodes/<node> via the PVE ACL
 *
 * The command payload is piped over stdin — it never touches argv, so no
 * amount of shell-metacharacters in it can affect how ssh/bash itself is
 * invoked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { requireNodeSysModify } from '@/lib/permissions';

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runViaStdin(
  file: string,
  args: string[],
  script: string,
  timeoutMs: number,
  maxBuffer: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      if (stdout.length > maxBuffer) {
        killed = true;
        child.kill('SIGKILL');
        reject(new Error('stdout exceeded maxBuffer'));
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > maxBuffer) {
        killed = true;
        child.kill('SIGKILL');
        reject(new Error('stderr exceeded maxBuffer'));
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (!killed) reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!killed) resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    child.stdin.end(script);
  });
}

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
    // Standalone PVE or restricted perms — fall through.
  }
  return node;
}

interface ExecRequest {
  command: string;
  node?: string;
  timeoutMs?: number;
}

const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as ExecRequest;
  if (!body?.command || typeof body.command !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid "command"' }, { status: 400 });
  }

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

  const timeout = body.timeoutMs ?? 5 * 60 * 1000;
  const maxBuffer = 10 * 1024 * 1024;
  const target = targetNode === localHost ? null : targetNode;

  try {
    const result = target
      ? await (async () => {
          const address = await resolveNodeAddress(target);
          return runViaStdin(
            'ssh',
            [
              '-o', 'StrictHostKeyChecking=accept-new',
              '-o', 'BatchMode=yes',
              '-o', 'ConnectTimeout=10',
              `root@${address}`,
              'bash', '-s',
            ],
            body.command,
            timeout,
            maxBuffer,
          );
        })()
      : await runViaStdin('bash', ['-s'], body.command, timeout, maxBuffer);

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
  }
}

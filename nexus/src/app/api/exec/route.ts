/**
 * Local + cluster-wide shell executor.
 *
 * - If `node` matches this host's hostname, runs locally via bash.
 * - Otherwise SSHes to `root@{node}` — relies on PVE's cluster-wide SSH trust
 *   (pvecm adds each member's key to /etc/ssh/ssh_known_hosts and authorized_keys).
 *
 * Auth: requires a valid Nexus session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { getSession } from '@/lib/auth';

const execFileP = promisify(execFile);

interface ExecRequest {
  command: string;
  node?: string;
  timeoutMs?: number;
}

// Valid PVE node names: alphanumeric + dot/dash/underscore. Used to block SSH flag injection.
const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as ExecRequest;
  if (!body?.command || typeof body.command !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid "command"' }, { status: 400 });
  }

  const localHost = hostname();
  const target = body.node && body.node !== localHost ? body.node : null;

  if (target !== null && !NODE_RE.test(target)) {
    return NextResponse.json({ error: `Invalid node name: ${target}` }, { status: 400 });
  }

  const timeout = body.timeoutMs ?? 5 * 60 * 1000;
  const maxBuffer = 10 * 1024 * 1024;

  try {
    const { stdout, stderr } = target
      ? await execFileP(
          'ssh',
          [
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=10',
            `root@${target}`,
            'bash', '-c', body.command,
          ],
          { timeout, maxBuffer },
        )
      : await execFileP('bash', ['-c', body.command], { timeout, maxBuffer });

    return NextResponse.json({ stdout, stderr, exitCode: 0 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return NextResponse.json(
      {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? '',
        exitCode: e.code ?? 1,
        error: e.message ?? 'Command failed',
      },
      { status: 200 },
    );
  }
}

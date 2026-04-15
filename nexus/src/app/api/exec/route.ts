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
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { getSession } from '@/lib/auth';

const execFileP = promisify(execFile);

interface PVEMembers {
  nodelist?: Record<string, { ip?: string; online?: number }>;
}

/** Look up a cluster node's IP via pmxcfs /etc/pve/.members — this is written
 *  automatically when nodes join the cluster, and contains the corosync IPs
 *  that actually route, regardless of DNS. Falls back to the node name. */
async function resolveNodeAddress(node: string): Promise<string> {
  try {
    const raw = await readFile('/etc/pve/.members', 'utf8');
    const parsed = JSON.parse(raw) as PVEMembers;
    const ip = parsed.nodelist?.[node]?.ip;
    if (ip) return ip;
  } catch {
    // File missing or unparseable — standalone PVE or restricted perms. Fall through.
  }
  return node;
}

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
    let stdout: string, stderr: string;
    if (target) {
      const address = await resolveNodeAddress(target);
      ({ stdout, stderr } = await execFileP(
        'ssh',
        [
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'BatchMode=yes',
          '-o', 'ConnectTimeout=10',
          `root@${address}`,
          'bash', '-c', body.command,
        ],
        { timeout, maxBuffer },
      ));
    } else {
      ({ stdout, stderr } = await execFileP('bash', ['-c', body.command], { timeout, maxBuffer }));
    }

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

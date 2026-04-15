/**
 * Local shell executor — runs commands as the Nexus service user (root, per install.sh)
 * on the Proxmox host that hosts Nexus. Used for installing tunnel agents and apt
 * operations that PVE's API doesn't expose directly.
 *
 * Auth: requires a valid Nexus session. Do not expose this without session guarding.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { getSession } from '@/lib/auth';

const execP = promisify(exec);

interface ExecRequest {
  command: string;
  /** Optional node name — if set and != our hostname, we refuse */
  node?: string;
  /** Timeout in ms (default 5 min) */
  timeoutMs?: number;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as ExecRequest;
  if (!body?.command || typeof body.command !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid "command"' }, { status: 400 });
  }

  const localHost = hostname();
  if (body.node && body.node !== localHost) {
    return NextResponse.json(
      {
        error: `Cannot run commands on remote node "${body.node}" — Nexus only executes locally on "${localHost}". Open Nexus on "${body.node}" to install there.`,
      },
      { status: 400 },
    );
  }

  try {
    const { stdout, stderr } = await execP(body.command, {
      timeout: body.timeoutMs ?? 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash',
    });
    return NextResponse.json({ stdout, stderr, exitCode: 0 });
  } catch (err) {
    // exec errors carry stdout/stderr/code on the error object
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

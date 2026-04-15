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

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;
const TRUSTED_ORIGINS = new Set([
  'https://raw.githubusercontent.com',
  'https://github.com',
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
    const child = spawn(file, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ upid: `nexus-script:${Date.now()}` });
      else reject(new Error(`script failed (exit ${code}): ${stderr.slice(0, 500)}`));
    });

    // The URL is passed to bash via stdin — it never touches an argv slot or
    // a shell string literal. `$SCRIPT_URL` below is a bash variable, not an
    // interpolation site.
    child.stdin.end(
      `set -euo pipefail\nSCRIPT_URL=${JSON.stringify(scriptUrl)}\ncurl -fsSL -- "$SCRIPT_URL" | bash\n`,
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

  const { node, scriptUrl, scriptName } = (await req.json()) as {
    node?: string;
    scriptUrl?: string;
    scriptName?: string;
  };

  if (!node || !scriptUrl || typeof node !== 'string' || typeof scriptUrl !== 'string') {
    return NextResponse.json({ error: 'node and scriptUrl are required' }, { status: 400 });
  }
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid node name' }, { status: 400 });
  }

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

  try {
    const address = await resolveNodeAddress(node);
    const { upid } = await pipeScriptToRemoteBash(node, address, parsed.toString());
    return NextResponse.json({ upid, node, scriptName: scriptName ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

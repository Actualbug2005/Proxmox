/**
 * Shared shell-execution primitives used by /api/exec and /api/tunnels/status.
 *
 * No authentication / authorization concerns live here — callers MUST gate
 * access at the route boundary before invoking these. The helpers themselves
 * just arrange a process spawn that's safe with respect to argv injection
 * (script payload always travels over stdin, never via argv or string
 * interpolation).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';

/** PVE node names: alphanumeric + dot/dash/underscore (PVE constraint, also
 *  prevents ssh-flag injection like `-oProxyCommand=…`). */
export const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Spawn `file` with `args`, pipe `script` into stdin, return captured output.
 * Killing the child on timeout or buffer overflow.
 */
export function runViaStdin(
  file: string,
  args: string[],
  script: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;

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

/** Look up a cluster node's corosync IP via /etc/pve/.members (pmxcfs).
 *  Falls back to the node name (suitable for standalone PVE or DNS hops). */
export async function resolveNodeAddress(node: string): Promise<string> {
  try {
    const raw = await readFile('/etc/pve/.members', 'utf8');
    const parsed = JSON.parse(raw) as PVEMembers;
    const ip = parsed.nodelist?.[node]?.ip;
    if (ip) return ip;
  } catch {
    /* standalone PVE or restricted perms — fall through to node name */
  }
  return node;
}

/**
 * Run `script` either locally (when `node` matches this host) or via ssh
 * `root@<node-ip>`. The script always travels over stdin — argv carries no
 * caller-controlled bytes.
 */
export async function runScriptOnNode(
  node: string,
  script: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const isLocal = node === hostname();
  if (isLocal) {
    return runViaStdin('bash', ['-s'], script, opts);
  }
  const address = await resolveNodeAddress(node);
  return runViaStdin(
    'ssh',
    [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      `root@${address}`,
      'bash', '-s',
    ],
    script,
    opts,
  );
}

/**
 * Spawn `script` on `node` and hand back the raw ChildProcess so the caller
 * can stream stdout/stderr directly — skipping the string buffering that
 * runScriptOnNode performs. Used for binary/large payloads (file downloads).
 *
 * The script is piped via stdin (same injection-safe path as runScriptOnNode).
 * The caller is responsible for:
 *   • attaching 'error' / 'exit' listeners,
 *   • killing the child if the consumer aborts,
 *   • consuming stderr (which often carries side-channel data like file size).
 */
export async function spawnScriptStream(
  node: string,
  script: string,
): Promise<ChildProcess> {
  const isLocal = node === hostname();
  let child: ChildProcess;
  if (isLocal) {
    child = spawn('bash', ['-s'], { stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    const address = await resolveNodeAddress(node);
    child = spawn(
      'ssh',
      [
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        `root@${address}`,
        'bash', '-s',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
  }
  child.stdin?.end(script);
  return child;
}

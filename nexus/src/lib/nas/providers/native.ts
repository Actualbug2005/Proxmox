/**
 * Native NAS provider — targets a PVE host running samba + nfs-kernel-server
 * directly. Talks to the node over the existing runScriptOnNode() ssh pipe.
 *
 * Implemented:
 *   • getShares     — reads /etc/samba/smb.conf and /etc/exports, parses and
 *                     correlates them into a unified NasShare[] list.
 *   • createShare   — collision-checks against existing shares, then appends
 *                     share entries to both config files (where the payload
 *                     requests each protocol) and reloads the daemons
 *                     without a full restart.
 *   • deleteShare   — resolves id → path, looks up the SMB stanza name, then
 *                     awk-rewrites both config files (write-to-tmp + atomic
 *                     mv) before reloading daemons.
 *   • getServices   — `systemctl is-active smbd nfs-kernel-server` → mapped
 *                     to NasService[] with running/stopped status.
 */
import type {
  CreateNasSharePayload,
  FileNode,
  NasProtocol,
  NasProvider,
  NasShare,
  NasService,
} from '@/types/nas';
import { Readable } from 'node:stream';
import { runScriptOnNode, spawnScriptStream } from '@/lib/remote-shell';

// ─── Parsing helpers (pure, unit-testable) ──────────────────────────────────

/** SMB sections that are never user-facing shares. */
const SMB_RESERVED = new Set(['global', 'homes', 'printers', 'print$']);

interface SmbShareRaw {
  path?: string;
  readOnly?: boolean;
}

/**
 * Parse smb.conf into a map of shareName -> { path, readOnly }.
 * Ignores reserved sections and any share that doesn't declare a path.
 */
export function parseSmbConf(text: string): Map<string, SmbShareRaw> {
  const shares = new Map<string, SmbShareRaw>();
  let current: string | null = null;

  for (const raw of text.split('\n')) {
    // Strip inline comments (# or ;). smb.conf treats both as comment leaders.
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) continue;

    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      current = sec[1].trim();
      continue;
    }
    if (!current || SMB_RESERVED.has(current.toLowerCase())) continue;

    const kv = line.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const value = kv[2].trim();

    const existing = shares.get(current) ?? {};
    if (key === 'path') existing.path = value;
    else if (key === 'read only') existing.readOnly = /^(yes|true|1)$/i.test(value);
    shares.set(current, existing);
  }

  for (const [name, data] of shares) {
    if (!data.path) shares.delete(name);
  }
  return shares;
}

interface NfsExportRaw {
  path: string;
  readOnly: boolean;
}

/**
 * Parse /etc/exports. Each line: `<path> <client>(<opts>) [<client>(<opts>)...]`.
 * Read-only is inferred from the first client spec's options.
 */
export function parseExports(text: string): NfsExportRaw[] {
  const out: NfsExportRaw[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const path = m[1];
    const rest = m[2];
    const opts = rest.match(/\(([^)]+)\)/)?.[1] ?? '';
    const readOnly = opts.split(',').map((s) => s.trim()).includes('ro');
    out.push({ path, readOnly });
  }
  return out;
}

/**
 * Combine SMB + NFS parse results into a unified NasShare[] keyed by path.
 * A path exported via both protocols collapses into a single row with
 * protocols: ['smb','nfs'] and the stricter readOnly of the two.
 */
export function correlateShares(
  smb: Map<string, SmbShareRaw>,
  nfs: NfsExportRaw[],
  serviceStatus: Record<NasProtocol, 'running' | 'stopped'>,
): NasShare[] {
  interface Accum {
    name: string;
    path: string;
    protocols: NasProtocol[];
    readOnly: boolean;
  }
  const byPath = new Map<string, Accum>();

  for (const [name, data] of smb) {
    if (!data.path) continue;
    byPath.set(data.path, {
      name,
      path: data.path,
      protocols: ['smb'],
      readOnly: Boolean(data.readOnly),
    });
  }

  for (const exp of nfs) {
    const existing = byPath.get(exp.path);
    if (existing) {
      if (!existing.protocols.includes('nfs')) existing.protocols.push('nfs');
      // Stricter wins — if either side marks the export read-only, the row is RO.
      existing.readOnly = existing.readOnly || exp.readOnly;
    } else {
      const name = exp.path.split('/').filter(Boolean).pop() ?? exp.path;
      byPath.set(exp.path, {
        name,
        path: exp.path,
        protocols: ['nfs'],
        readOnly: exp.readOnly,
      });
    }
  }

  return Array.from(byPath.values()).map<NasShare>((s) => {
    // A share is 'inactive' when every protocol serving it has a stopped daemon.
    const anyRunning = s.protocols.some((p) => serviceStatus[p] === 'running');
    return {
      id: Buffer.from(s.path).toString('base64url'),
      name: s.name,
      path: s.path,
      protocols: s.protocols,
      status: anyRunning ? 'active' : 'inactive',
      readOnly: s.readOnly,
    };
  });
}

// ─── Remote scripts ─────────────────────────────────────────────────────────

/** One shot: cat both config files, emit service status, delimited for JS splitting. */
const FETCH_SCRIPT = `set -euo pipefail
echo '===NEXUS_SMB_START==='
cat /etc/samba/smb.conf 2>/dev/null || true
echo '===NEXUS_SMB_END==='
echo '===NEXUS_EXPORTS_START==='
cat /etc/exports 2>/dev/null || true
echo '===NEXUS_EXPORTS_END==='
echo '===NEXUS_STATUS_START==='
printf 'smbd=%s\\n' "$(systemctl is-active smbd 2>/dev/null || echo inactive)"
printf 'nfs=%s\\n'  "$(systemctl is-active nfs-kernel-server 2>/dev/null || echo inactive)"
echo '===NEXUS_STATUS_END==='
`;

function extractSection(stdout: string, start: string, end: string): string {
  const re = new RegExp(`${start}\\n([\\s\\S]*?)\\n${end}`);
  return stdout.match(re)?.[1] ?? '';
}

function parseServiceStatus(block: string): Record<NasProtocol, 'running' | 'stopped'> {
  const out: Record<NasProtocol, 'running' | 'stopped'> = { smb: 'stopped', nfs: 'stopped' };
  for (const line of block.split('\n')) {
    const [k, v] = line.split('=');
    if (!k || !v) continue;
    if (k.trim() === 'smbd') out.smb = v.trim() === 'active' ? 'running' : 'stopped';
    if (k.trim() === 'nfs') out.nfs = v.trim() === 'active' ? 'running' : 'stopped';
  }
  return out;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/**
 * Build the create-share script. Values are base64-encoded in TS and decoded
 * inside bash — so the raw payload never appears on a shell argv or inside
 * an unquoted string, even if it contains $, backticks, newlines, etc.
 */
function buildCreateScript(payload: CreateNasSharePayload): string {
  const wantSmb = payload.protocols.includes('smb') ? '1' : '0';
  const wantNfs = payload.protocols.includes('nfs') ? '1' : '0';
  const readOnlySmb = payload.readOnly ? 'yes' : 'no';
  const nfsMode = payload.readOnly ? 'ro' : 'rw';

  // The single-quoted base64 literals are safe — base64 alphabet is
  // [A-Za-z0-9+/=], none of which terminate a single-quoted bash string.
  return `set -euo pipefail
NAME="$(printf '%s' '${b64(payload.name)}' | base64 -d)"
SHARE_PATH="$(printf '%s' '${b64(payload.path)}' | base64 -d)"
READ_ONLY='${readOnlySmb}'
NFS_MODE='${nfsMode}'
WANT_SMB='${wantSmb}'
WANT_NFS='${wantNfs}'

# Ensure the directory exists before daemons try to export it.
mkdir -p -- "$SHARE_PATH"

if [ "$WANT_SMB" = "1" ]; then
  {
    printf '\\n[%s]\\n' "$NAME"
    printf '   path = %s\\n' "$SHARE_PATH"
    printf '   read only = %s\\n' "$READ_ONLY"
    printf '   guest ok = no\\n'
  } >> /etc/samba/smb.conf
  smbcontrol all reload-config >/dev/null 2>&1 || true
fi

if [ "$WANT_NFS" = "1" ]; then
  printf '%s *(%s,sync,no_subtree_check)\\n' "$SHARE_PATH" "$NFS_MODE" >> /etc/exports
  exportfs -ra
fi
`;
}

/**
 * Build the delete-share script.
 *
 * SMB: awk skips the [name] stanza and every line that follows up to (but not
 *      including) the next [section] header or EOF. The target name is read
 *      from ENVIRON[] — awk never sees it via -v, which would interpret
 *      backslash escapes.
 * NFS: awk prints every line whose first whitespace-delimited field isn't the
 *      target path. Same ENVIRON[] trick to dodge -v escape processing.
 *
 * Both rewrites are write-to-tmp + atomic mv — an interrupted awk can't leave
 * a half-written config behind.
 */
function buildDeleteScript(name: string, path: string, wantSmb: boolean, wantNfs: boolean): string {
  return `set -euo pipefail
SHARE_NAME="$(printf '%s' '${b64(name)}' | base64 -d)"
SHARE_PATH="$(printf '%s' '${b64(path)}' | base64 -d)"
export SHARE_NAME SHARE_PATH

if [ '${wantSmb ? '1' : '0'}' = '1' ]; then
  awk '
    function norm(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
    BEGIN { target = "[" ENVIRON["SHARE_NAME"] "]"; skip = 0 }
    /^[[:space:]]*\\[.*\\][[:space:]]*$/ {
      if (norm($0) == target) { skip = 1; next }
      skip = 0
    }
    !skip { print }
  ' /etc/samba/smb.conf > /etc/samba/smb.conf.nexus.new
  mv /etc/samba/smb.conf.nexus.new /etc/samba/smb.conf
  smbcontrol all reload-config >/dev/null 2>&1 || true
fi

if [ '${wantNfs ? '1' : '0'}' = '1' ]; then
  awk 'BEGIN { p = ENVIRON["SHARE_PATH"] } $1 != p { print }' /etc/exports > /etc/exports.nexus.new
  mv /etc/exports.nexus.new /etc/exports
  exportfs -ra
fi
`;
}

/** Probe daemon status on the target node.
 *  `systemctl is-active smbd nfs-kernel-server` prints one status per unit,
 *  in argument order. The `|| true` keeps us past systemctl's non-zero exit
 *  when any unit is inactive. */
const SERVICES_SCRIPT = `systemctl is-active smbd nfs-kernel-server 2>/dev/null || true`;

/**
 * Build the directory-listing script.
 *
 * Three layers of traversal defense:
 *   1. Caller (route/provider) rejects '..' and leading '/' in subPath.
 *   2. Base64 round-trip prevents shell injection in sharePath/subPath.
 *   3. `realpath -e` resolves symlinks, then we prefix-check the result
 *      against the share's own resolved root — catches symlinks inside the
 *      share that point to /etc, /root, etc.
 *
 * Output is the GNU-find -printf JSON-fragment format: one object per entry,
 * comma-terminated. bash strips the trailing comma and wraps in [...] to
 * produce a parseable JSON array. Known limitation: filenames containing
 * ", \\, or raw control characters will break JSON.parse — we surface that
 * as a clear error rather than silently dropping entries.
 */
function buildListDirScript(sharePath: string, subPath: string): string {
  return `set -euo pipefail
SHARE_PATH="$(printf '%s' '${b64(sharePath)}' | base64 -d)"
SUB_PATH="$(printf '%s' '${b64(subPath)}' | base64 -d)"

if [ -n "$SUB_PATH" ]; then
  TARGET="$SHARE_PATH/$SUB_PATH"
else
  TARGET="$SHARE_PATH"
fi

# Canonicalise both paths and verify the target still lives under the share
# root. -e forces existence; any missing component fails the script.
REAL_SHARE="$(realpath -e "$SHARE_PATH")"
REAL_TARGET="$(realpath -e "$TARGET")"

case "$REAL_TARGET" in
  "$REAL_SHARE"|"$REAL_SHARE"/*) ;;
  *)
    echo "Path escapes share root" >&2
    exit 3
    ;;
esac

if [ ! -d "$REAL_TARGET" ]; then
  echo "Not a directory" >&2
  exit 2
fi

# One level deep; GNU -printf emits the JSON-fragment format we strip below.
OUTPUT=$(find "$REAL_TARGET" -mindepth 1 -maxdepth 1 -printf '{"name":"%f","type":"%y","size":%s,"mtime":%T@},')
# Strip the trailing ',' so JSON.parse accepts the result. Empty listing ⇒ [].
OUTPUT="\${OUTPUT%,}"
printf '[%s]' "$OUTPUT"
`;
}

interface FindEntryRaw {
  name: string;
  type: string;
  size: number;
  mtime: number;
}

/** Map GNU find's single-letter type codes to our FileNode['type']. Returns
 *  null for socket/fifo/block/char-device entries — the UI has nothing
 *  sensible to do with them, so drop rather than surface as 'file'. */
function mapGnuType(c: string): FileNode['type'] | null {
  if (c === 'd') return 'dir';
  if (c === 'f') return 'file';
  if (c === 'l') return 'symlink';
  return null;
}

/**
 * Build the atomic validate+stream script. realpath prefix-check and the
 * cat that streams the file live in the same process — there's no TS round
 * trip between "is this path safe?" and "open this path for reading", so a
 * symlink swap between check and use can't bait us onto a different file.
 *
 * Size goes to stderr so stdout stays a pure byte stream the HTTP layer
 * can forward unchanged.
 */
function buildDownloadScript(sharePath: string, subPath: string): string {
  return `set -euo pipefail
SHARE_PATH="$(printf '%s' '${b64(sharePath)}' | base64 -d)"
SUB_PATH="$(printf '%s' '${b64(subPath)}' | base64 -d)"
TARGET="$SHARE_PATH/$SUB_PATH"
REAL_SHARE="$(realpath -e "$SHARE_PATH")"
REAL_TARGET="$(realpath -e "$TARGET")"

case "$REAL_TARGET" in
  "$REAL_SHARE"|"$REAL_SHARE"/*)
    if [ ! -f "$REAL_TARGET" ]; then
      echo "Not a regular file" >&2
      exit 4
    fi
    stat -c "%s" "$REAL_TARGET" >&2
    exec cat "$REAL_TARGET"
    ;;
  *)
    echo "Path escapes share root" >&2
    exit 3
    ;;
esac
`;
}

function parseListDirOutput(stdout: string, subPath: string): FileNode[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed: FindEntryRaw[];
  try {
    parsed = JSON.parse(trimmed) as FindEntryRaw[];
  } catch (err) {
    throw new Error(
      `listDirectory: failed to parse find output — likely a filename with ", \\\\, or control chars (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const out: FileNode[] = [];
  for (const e of parsed) {
    const type = mapGnuType(e.type);
    if (!type) continue;
    out.push({
      name: e.name,
      type,
      size: e.size,
      mtime: e.mtime,
      relativePath: subPath ? `${subPath}/${e.name}` : e.name,
    });
  }
  return out;
}

// ─── Provider implementation ────────────────────────────────────────────────

/**
 * Fetch + parse the full share list on a node. Factored out so collision
 * detection (createShare) and target lookup (deleteShare) can reuse it
 * without going through the provider object's `this`.
 */
async function fetchAllShares(node: string): Promise<NasShare[]> {
  const res = await runScriptOnNode(node, FETCH_SCRIPT, { timeoutMs: 20_000 });
  if (res.exitCode !== 0) {
    throw new Error(`getShares: remote script exited ${res.exitCode}: ${res.stderr.slice(0, 300)}`);
  }
  const smbText = extractSection(res.stdout, '===NEXUS_SMB_START===', '===NEXUS_SMB_END===');
  const expText = extractSection(res.stdout, '===NEXUS_EXPORTS_START===', '===NEXUS_EXPORTS_END===');
  const statusText = extractSection(res.stdout, '===NEXUS_STATUS_START===', '===NEXUS_STATUS_END===');

  const smb = parseSmbConf(smbText);
  const nfs = parseExports(expText);
  const status = parseServiceStatus(statusText);

  return correlateShares(smb, nfs, status);
}

export const nativeProvider: NasProvider = {
  getShares(node: string): Promise<NasShare[]> {
    return fetchAllShares(node);
  },

  async createShare(node: string, payload: CreateNasSharePayload): Promise<NasShare> {
    // Pre-flight collision check: running samba/nfs would still accept
    // duplicates but surface cryptic errors on the next reload. We'd rather
    // fail fast with a clear message.
    const existing = await fetchAllShares(node);
    const nameTaken = existing.some((s) => s.name === payload.name);
    const pathTaken = existing.some((s) => s.path === payload.path);
    if (nameTaken || pathTaken) {
      throw new Error('Conflict: Share name or path already exists.');
    }

    const res = await runScriptOnNode(node, buildCreateScript(payload), { timeoutMs: 30_000 });
    if (res.exitCode !== 0) {
      throw new Error(
        `createShare: remote script exited ${res.exitCode}: ${res.stderr.slice(0, 500)}`,
      );
    }
    return {
      id: Buffer.from(payload.path, 'utf8').toString('base64url'),
      name: payload.name,
      path: payload.path,
      protocols: payload.protocols,
      status: 'active',
      readOnly: payload.readOnly,
    };
  },

  async deleteShare(node: string, id: string): Promise<void> {
    // Decode the opaque id back to its originating path. We still look up
    // the full share record because the SMB stanza header uses `name`, not
    // path — awk needs the exact section label to remove.
    const path = Buffer.from(id, 'base64url').toString('utf8');
    const shares = await fetchAllShares(node);
    const target = shares.find((s) => s.id === id);
    if (!target) {
      throw new Error(`Share not found: id=${id} (path=${path})`);
    }

    const wantSmb = target.protocols.includes('smb');
    const wantNfs = target.protocols.includes('nfs');
    const script = buildDeleteScript(target.name, target.path, wantSmb, wantNfs);

    const res = await runScriptOnNode(node, script, { timeoutMs: 30_000 });
    if (res.exitCode !== 0) {
      throw new Error(
        `deleteShare: remote script exited ${res.exitCode}: ${res.stderr.slice(0, 500)}`,
      );
    }
  },

  async getServices(node: string): Promise<NasService[]> {
    const res = await runScriptOnNode(node, SERVICES_SCRIPT, { timeoutMs: 10_000 });
    // `systemctl is-active` exits non-zero when any unit is inactive —
    // that's expected for a stopped-daemon case, not a script error.
    // The `|| true` in SERVICES_SCRIPT already absorbs it, so any non-zero
    // here is something worse (e.g. ssh failed).
    if (res.exitCode !== 0) {
      throw new Error(`getServices: remote script exited ${res.exitCode}: ${res.stderr.slice(0, 300)}`);
    }
    const lines = res.stdout.trim().split('\n');
    const smbdStatus = (lines[0] ?? '').trim();
    const nfsStatus = (lines[1] ?? '').trim();
    return [
      { protocol: 'smb', status: smbdStatus === 'active' ? 'running' : 'stopped' },
      { protocol: 'nfs', status: nfsStatus === 'active' ? 'running' : 'stopped' },
    ];
  },

  async listDirectory(node: string, shareId: string, subPath: string): Promise<FileNode[]> {
    // Layer 1: reject traversal at the TS boundary — regex-only, no
    // filesystem state involved.
    if (subPath.includes('..')) {
      throw new Error('Invalid path: contains directory traversal (..)');
    }
    if (subPath.startsWith('/')) {
      throw new Error('Invalid path: must be relative to the share root');
    }

    // Resolve shareId → share record so we know the share's root path.
    const shares = await fetchAllShares(node);
    const share = shares.find((s) => s.id === shareId);
    if (!share) {
      throw new Error(`Share not found: id=${shareId}`);
    }

    // Layers 2 + 3 live inside the script (base64 injection + realpath
    // prefix check).
    const script = buildListDirScript(share.path, subPath);
    const res = await runScriptOnNode(node, script, { timeoutMs: 15_000 });
    if (res.exitCode !== 0) {
      throw new Error(
        `listDirectory: remote script exited ${res.exitCode}: ${res.stderr.slice(0, 300)}`,
      );
    }

    return parseListDirOutput(res.stdout, subPath);
  },

  async downloadFile(
    node: string,
    shareId: string,
    subPath: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; filename: string; size: number }> {
    // Layer 1: same string-level traversal rejection as listDirectory.
    if (subPath.includes('..')) {
      throw new Error('Invalid path: contains directory traversal (..)');
    }
    if (subPath.startsWith('/')) {
      throw new Error('Invalid path: must be relative to the share root');
    }
    if (subPath === '') {
      throw new Error('Invalid path: cannot download the share root itself');
    }

    const shares = await fetchAllShares(node);
    const share = shares.find((s) => s.id === shareId);
    if (!share) {
      throw new Error(`Share not found: id=${shareId}`);
    }

    const script = buildDownloadScript(share.path, subPath);
    const child = await spawnScriptStream(node, script);
    const { stdout, stderr } = child;
    if (!stdout || !stderr) {
      // 'pipe' stdio was requested, so this should never fire — guard for TS.
      child.kill('SIGKILL');
      throw new Error('downloadFile: child process has no stdio pipes');
    }

    // Wait for either:
    //   • The first full line on stderr (the size, as decimal digits), OR
    //   • The child exiting with a non-zero code before emitting size.
    // Whichever happens first resolves/rejects this promise — once resolved,
    // the caller owns the stdout stream.
    const size = await new Promise<number>((resolve, reject) => {
      let stderrBuf = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        stderr.off('data', onStderr);
        child.off('exit', onExit);
        child.off('error', onError);
        fn();
      };

      const onStderr = (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
        const nl = stderrBuf.indexOf('\n');
        if (nl === -1) return;
        const firstLine = stderrBuf.slice(0, nl).trim();
        if (/^\d+$/.test(firstLine)) {
          finish(() => resolve(parseInt(firstLine, 10)));
        } else {
          child.kill('SIGTERM');
          finish(() =>
            reject(
              new Error(
                `downloadFile: unexpected stderr before size: ${stderrBuf.slice(0, 300)}`,
              ),
            ),
          );
        }
      };

      const onExit = (code: number | null) => {
        finish(() =>
          reject(
            new Error(
              `downloadFile: child exited ${code ?? 'null'} before emitting size: ${stderrBuf.slice(0, 300)}`,
            ),
          ),
        );
      };

      const onError = (err: Error) => {
        finish(() => reject(err));
      };

      stderr.on('data', onStderr);
      child.on('exit', onExit);
      child.on('error', onError);
    });

    // After the promise resolves we still want to know if the child crashes
    // mid-stream — unhandled 'error' events on the Node process crash the
    // Node runtime, so attach a no-op listener. `Readable.toWeb` propagates
    // the error to the Web stream consumer.
    child.on('error', (err) => {
      console.warn('[nas.downloadFile] child error after handoff:', err.message);
    });
    // Drain stderr so the buffer doesn't fill and back-pressure the child.
    stderr.resume();
    // If the consumer aborts the Web stream, Readable.toWeb destroys stdout,
    // which propagates EPIPE → ssh/bash exit. Belt-and-braces: also kill the
    // child when stdout closes unexpectedly so we never leak a remote cat.
    stdout.on('close', () => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
      }
    });

    const filename = subPath.split('/').pop() ?? 'download';
    const webStream = Readable.toWeb(stdout) as ReadableStream<Uint8Array>;
    return { stream: webStream, filename, size };
  },
};

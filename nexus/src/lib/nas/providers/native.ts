/**
 * Native NAS provider — targets a PVE host running samba + nfs-kernel-server
 * directly. Talks to the node over the existing runScriptOnNode() ssh pipe.
 *
 * Implemented in Phase 2:
 *   • getShares     — reads /etc/samba/smb.conf and /etc/exports, parses and
 *                     correlates them into a unified NasShare[] list.
 *   • createShare   — appends share entries to both config files (where the
 *                     payload requests each protocol) and reloads the daemons
 *                     without a full restart.
 *
 * Left as notImplemented() for a later phase:
 *   • deleteShare, getServices.
 */
import type {
  CreateNasSharePayload,
  NasProtocol,
  NasProvider,
  NasShare,
  NasService,
} from '@/types/nas';
import { runScriptOnNode } from '@/lib/remote-shell';

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

/**
 * Build the create-share script. Values are base64-encoded in TS and decoded
 * inside bash — so the raw payload never appears on a shell argv or inside
 * an unquoted string, even if it contains $, backticks, newlines, etc.
 */
function buildCreateScript(payload: CreateNasSharePayload): string {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
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

// ─── Provider implementation ────────────────────────────────────────────────

function notImplemented(): never {
  throw new Error('Not implemented');
}

export const nativeProvider: NasProvider = {
  async getShares(node: string): Promise<NasShare[]> {
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
  },

  async createShare(node: string, payload: CreateNasSharePayload): Promise<NasShare> {
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

  async deleteShare(_node: string, _id: string): Promise<void> {
    notImplemented();
  },

  async getServices(_node: string): Promise<NasService[]> {
    notImplemented();
  },
};

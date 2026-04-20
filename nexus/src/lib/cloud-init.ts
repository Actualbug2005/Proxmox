/**
 * Cloud-init form-to-PVE translation helpers.
 *
 * Pure functions. The CloudInitForm component calls these to turn pasted
 * strings + radio selections into the exact strings PVE's VM config
 * accepts. Stays in its own module so the translation rules are
 * unit-tested independently of React.
 *
 * References:
 *   https://pve.proxmox.com/wiki/Cloud-Init_Support
 *   https://pve.proxmox.com/wiki/Cloud-Init_FAQ
 */

const SSH_ALGO_PREFIXES = [
  'ssh-ed25519',
  'ssh-rsa',
  'ssh-dss',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ecdsa-sha2-nistp256@openssh.com',
  'sk-ssh-ed25519@openssh.com',
] as const;

// ─── SSH keys ────────────────────────────────────────────────────────────────

export type NormalizeSshKeysResult =
  | { ok: true; value: string; count: number }
  | { ok: false; errors: string[] };

/**
 * Accept a textarea-style input (any line endings, comments, blanks) and
 * produce the multi-line string PVE's `sshkeys` field expects. Each
 * surviving line must begin with a recognized SSH algorithm prefix —
 * everything else is rejected with a clear reason so the form can
 * inline-render the errors next to the textarea.
 */
export function normalizeSshKeys(raw: string): NormalizeSshKeysResult {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  const kept: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    if (line.startsWith('#')) continue;
    const hasKnownPrefix = SSH_ALGO_PREFIXES.some((p) => line.startsWith(`${p} `));
    if (!hasKnownPrefix) {
      errors.push(
        `Line ${i + 1}: missing a recognized SSH algorithm prefix (ssh-ed25519, ssh-rsa, …).`,
      );
      continue;
    }
    kept.push(line);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: kept.join('\n'), count: kept.length };
}

// ─── ipconfigN ───────────────────────────────────────────────────────────────

export type Ipv4Mode = 'dhcp' | 'static' | 'none';
export type Ipv6Mode = 'dhcp' | 'auto' | 'static' | 'none';

export interface NicConfigInput {
  ipv4Mode: Ipv4Mode;
  ipv4Cidr?: string;
  ipv4Gw?: string;
  ipv6Mode: Ipv6Mode;
  ipv6Cidr?: string;
  ipv6Gw?: string;
}

/**
 * Compose one `ipconfigN` string from form state. PVE accepts both
 * families on the same field, comma-separated; we emit them in a stable
 * v4-then-v6 order so config diffs read deterministically.
 *
 * Returns "" when both modes are `none` — caller should drop the field
 * rather than send an empty string (which would clear an existing value
 * on PVE).
 */
export function buildIpconfig(input: NicConfigInput): string {
  const parts: string[] = [];

  if (input.ipv4Mode === 'dhcp') {
    parts.push('ip=dhcp');
  } else if (input.ipv4Mode === 'static') {
    if (input.ipv4Cidr) parts.push(`ip=${input.ipv4Cidr}`);
    if (input.ipv4Gw) parts.push(`gw=${input.ipv4Gw}`);
  }

  if (input.ipv6Mode === 'dhcp') {
    parts.push('ip6=dhcp');
  } else if (input.ipv6Mode === 'auto') {
    parts.push('ip6=auto');
  } else if (input.ipv6Mode === 'static') {
    if (input.ipv6Cidr) parts.push(`ip6=${input.ipv6Cidr}`);
    if (input.ipv6Gw) parts.push(`gw6=${input.ipv6Gw}`);
  }

  return parts.join(',');
}

// ─── Form validation regexes (re-exported for the form component) ───────────

// Validation primitives kept as `safe-regex`-clean patterns. The RFC 1123
// hostname's "no trailing hyphen" rule is enforced by isValidHostname()
// rather than in the regex itself — the nested-quantifier form
// /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/ trips safe-regex's heuristic
// even though it's mathematically bounded.
const HOSTNAME_CHARS_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** RFC 1123 hostname, lowercase-only. */
export const HOSTNAME_RE = {
  test: (s: string): boolean =>
    HOSTNAME_CHARS_RE.test(s) && !s.endsWith('-'),
};
/** POSIX Linux username. */
export const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
/** Pragmatic IPv4 + CIDR (not exhaustive; PVE does the real validation). */
export const IPV4_CIDR_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/(?:0?[0-9]|[12][0-9]|3[0-2])$/;
/** Pragmatic IPv4 address. */
export const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

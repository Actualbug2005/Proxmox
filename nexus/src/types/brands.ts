/**
 * Branded primitive types for cross-wire-bug prevention.
 *
 * Background: this codebase passes IDs as raw `number` and `string` across
 * many boundaries — VM ids, node names, PVE userids, session tickets, CSRF
 * tokens, batch ids. They are structurally identical, so a refactor that
 * accidentally swaps `vmid` for `nodeName` (or `userid` for `csrfToken`)
 * type-checks but breaks at runtime. Branded types add a phantom marker
 * that's invisible at runtime but requires an explicit parse / cast at
 * construction, turning every "where does trust enter?" decision into a
 * deliberate code change.
 *
 * Usage: import the brand + its parser. The parser is the *only* sanctioned
 * way to construct a branded value from raw input — any `as VmId` cast is
 * a code smell that should be replaced with a parse + validation step.
 *
 * Migration plan: this module is shipped as a new export surface in
 * Phase H. Existing call sites continue to work because the brands aren't
 * yet adopted in `types/proxmox.ts`. Future code is expected to consume
 * these for new APIs, and the existing types will be migrated in a
 * follow-up Tier-4 cleanup batch (one ID at a time to keep PRs reviewable).
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

declare const __brand: unique symbol;

/** Phantom-tagged type. Structurally identical to T at runtime. */
export type Branded<T, B extends string> = T & { readonly [__brand]: B };

// ─── PVE identifiers ─────────────────────────────────────────────────────────

/** PVE VM/CT id (1..999_999_999, integer). */
export type VmId = Branded<number, 'VmId'>;

export function parseVmId(n: unknown): VmId {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 999_999_999) {
    throw new TypeError(`Invalid VmId: ${typeof n}: ${String(n)}`);
  }
  return n as VmId;
}

/** PVE node name. Must match the same regex remote-shell uses for ssh-flag-injection guard. */
export type NodeName = Branded<string, 'NodeName'>;

const NODE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;

export function parseNodeName(s: unknown): NodeName {
  if (typeof s !== 'string' || !NODE_NAME_RE.test(s)) {
    throw new TypeError(`Invalid NodeName: ${typeof s}: ${String(s)}`);
  }
  return s as NodeName;
}

/** PVE userid in `<user>@<realm>` form. */
export type Userid = Branded<string, 'Userid'>;

const USERID_RE = /^[A-Za-z0-9._\-+]+@[a-z][a-z0-9_]*$/;

export function parseUserid(s: unknown): Userid {
  if (typeof s !== 'string' || !USERID_RE.test(s)) {
    throw new TypeError(`Invalid Userid: ${typeof s}: ${String(s)}`);
  }
  return s as Userid;
}

// ─── Auth tokens ────────────────────────────────────────────────────────────

/** Opaque PVE session ticket. Constructor only validates non-empty + max length. */
export type SessionTicket = Branded<string, 'SessionTicket'>;

export function parseSessionTicket(s: unknown): SessionTicket {
  if (typeof s !== 'string' || s.length === 0 || s.length > 4096) {
    throw new TypeError('Invalid SessionTicket');
  }
  return s as SessionTicket;
}

/** Nexus CSRF token (HMAC-SHA-256 hex digest, 64 chars). */
export type CsrfToken = Branded<string, 'CsrfToken'>;

export function parseCsrfToken(s: unknown): CsrfToken {
  if (typeof s !== 'string' || !/^[0-9a-f]{64}$/.test(s)) {
    throw new TypeError('Invalid CsrfToken');
  }
  return s as CsrfToken;
}

/**
 * PVE CSRFPreventionToken — the token PVE's own API expects in the
 * `CSRFPreventionToken` request header. Format is unspecified in the PVE
 * docs and varies across major versions (PVE 7 used `timestamp:base64sig`,
 * PVE 8+ mixes in other prefixes). Validate only the load-bearing bit:
 * non-empty string, reasonable length. DO NOT conflate with `CsrfToken`
 * above — that's the Nexus-internal double-submit cookie and has a fixed
 * HMAC-SHA-256 hex shape; they share a name but not a format.
 */
export type PveCsrfToken = Branded<string, 'PveCsrfToken'>;

export function parsePveCsrfToken(s: unknown): PveCsrfToken {
  if (typeof s !== 'string' || s.length === 0 || s.length > 512) {
    throw new TypeError('Invalid PveCsrfToken');
  }
  return s as PveCsrfToken;
}

// ─── Domain identifiers ─────────────────────────────────────────────────────

/** Bulk-lifecycle batch id (randomUUID). */
export type BatchId = Branded<string, 'BatchId'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBatchId(s: unknown): BatchId {
  if (typeof s !== 'string' || !UUID_RE.test(s)) {
    throw new TypeError(`Invalid BatchId: ${String(s)}`);
  }
  return s as BatchId;
}

/** Community-script slug (kebab-case, 1..63 chars). */
export type Slug = Branded<string, 'Slug'>;

export function parseSlug(s: unknown): Slug {
  if (typeof s !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) {
    throw new TypeError(`Invalid Slug: ${String(s)}`);
  }
  return s as Slug;
}

/** PVE-extended cron expression. Validation is delegated to lib/cron-match. */
export type CronExpr = Branded<string, 'CronExpr'>;

/**
 * Construct a CronExpr WITHOUT validation — use only when you've already
 * called `validateCron(s)` from `lib/cron-match` and know it's safe. The
 * brand module can't re-export a validating parser because that would
 * pull the cron grammar into every brand consumer; callers should
 * `validateCron` first, then wrap with `unsafeCronExpr`.
 */
export function unsafeCronExpr(s: string): CronExpr {
  return s as CronExpr;
}

/** Relative path under a NAS share. Forbids `..` and absolute paths. */
export type SafeRelPath = Branded<string, 'SafeRelPath'>;

export function parseSafeRelPath(raw: unknown): SafeRelPath {
  if (typeof raw !== 'string') {
    throw new TypeError(`Invalid SafeRelPath: ${typeof raw}`);
  }
  const norm = raw.replace(/^\/+/, '');
  if (norm.split('/').some((s) => s === '..' || s === '')) {
    throw new TypeError(`Unsafe path: ${raw}`);
  }
  return norm as SafeRelPath;
}

// ─── PVE-specific narrows ───────────────────────────────────────────────────

/** Strip the brand back to the underlying primitive. Use sparingly — most
 *  consumers can pass the branded value directly because brands erase. */
export function unbrand<T, B extends string>(b: Branded<T, B>): T {
  return b as T;
}

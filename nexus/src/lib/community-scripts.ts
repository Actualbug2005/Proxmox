/**
 * Community Scripts fetcher — PocketBase edition.
 *
 * Upstream history: the community-scripts project used to ship per-slug
 * manifests as static files in its Git repo (`json/<slug>.json` + an
 * aggregated `website/src/data/scripts.json`). In early 2026 it migrated to a
 * PocketBase public API — see community-scripts/ProxmoxVE-Local PR #510
 * "migrate from JSON files to PocketBase public API" — and the old paths now
 * 404. This module mirrors the new reference implementation (pbScripts.ts in
 * ProxmoxVE-Local) while preserving the CommunityScript / ScriptManifest
 * shape our UI already consumes.
 *
 *   Collections (all public / unauthenticated reads):
 *     script_scripts     — one record per script, card + full detail
 *     script_categories  — category lookup (id, name, icon, sort_order)
 *     z_ref_script_types — type slug lookup ("lxc" | "vm" | "pve" | "addon" | …)
 *
 *   The PocketBase record's `type` field is a relation; we always request
 *   `expand=categories,type` so `expand.type.type` gives us the human slug
 *   rather than an opaque record ID.
 *
 *   Install scripts themselves still live in the main ProxmoxVE repo:
 *     ct/<slug>.sh              — LXC install (type `lxc` → our `ct`)
 *     ct/alpine-<slug>.sh       — Alpine install-method variant
 *     vm/<slug>.sh              — VM install
 *     misc/<slug>.sh            — misc / pve helpers
 *     addon/<slug>.sh           — addon install (when present)
 *     turnkey/<slug>.sh         — TurnKey-based LXC
 *
 *   We build the full raw.githubusercontent URL per install method so the
 *   /api/scripts/run route can validate it against its HTTPS allow-list.
 */

import type {
  CommunityScript,
  InstallMethod,
  ScriptNote,
} from '@/types/proxmox';

export type { CommunityScript, InstallMethod, ScriptNote };

// ─── Endpoints / config ──────────────────────────────────────────────────────

const PB_BASE = 'https://db.community-scripts.org';
const SCRIPTS_COLLECTION = `${PB_BASE}/api/collections/script_scripts/records`;
const REPO_RAW_BASE = 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main';
const CACHE_REVALIDATE_S = 3600;
const FETCH_TIMEOUT_MS = 10_000;
/** PocketBase hard-caps perPage at 500. Our dataset (~500 scripts) fits. */
const PB_PAGE_SIZE = 500;

// ─── Re-exported / extended public interfaces ────────────────────────────────

/**
 * Full manifest for a single script. Superset of CommunityScript exported
 * by /api/scripts/[slug]. The extra `options` field is retained as optional
 * — the upstream PocketBase schema no longer ships per-script option
 * declarations, so it's always absent today, but the field is preserved for
 * consumers that already type-guard `manifest.options`.
 */
export interface ScriptManifest extends CommunityScript {
  options?: ScriptOption[];
}

/**
 * Legacy per-script option descriptor. Retained as a type-only export so
 * downstream code that still references `ScriptOption` compiles; the new
 * upstream schema does not populate it.
 */
export interface ScriptOption {
  label: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'password' | 'select';
  default?: string | number | boolean;
  choices?: string[];
  required?: boolean;
  description?: string;
}

export interface ScriptCategory {
  name: string;
  slug: string;
  scripts: CommunityScript[];
}

// ─── Structured fetch errors ─────────────────────────────────────────────────

/**
 *   timeout  → 504 Gateway Timeout
 *   network  → 502 (no response at all)
 *   http     → 502 (upstream non-2xx)
 *   parse    → 502 (body wasn't valid JSON / wrong shape)
 *   empty    → 502 (upstream responded but returned zero records)
 */
export type FetchErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'empty';

/** Kinds where `status` MUST NOT appear (no HTTP response was received or the
 *  response wasn't an HTTP-status-bearing error). */
type NonHttpKind = Exclude<FetchErrorKind, 'http'>;

/**
 * Discriminated error class. Constructor overloads enforce the kind/status
 * invariant at compile time — `kind: 'http'` requires a status, all other
 * kinds forbid one. Prior optional-status shape silently allowed inconsistent
 * combinations.
 */
export class UpstreamFetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly status?: number;
  readonly url: string;

  constructor(kind: 'http', url: string, message: string, status: number);
  constructor(kind: NonHttpKind, url: string, message: string);
  constructor(kind: FetchErrorKind, url: string, message: string, status?: number) {
    super(message);
    this.name = 'UpstreamFetchError';
    this.kind = kind;
    if (kind === 'http') {
      if (status === undefined) {
        // The overload signatures prevent this at compile time, but a
        // dynamic caller (Reflect.construct, JSON-revived error, etc.)
        // could still slip through. Default to 0 rather than leave
        // status undefined for an http error.
        this.status = 0;
      } else {
        this.status = status;
      }
    }
    this.url = url;
  }
}

// ─── Internal fetch helper ───────────────────────────────────────────────────

async function fetchUpstreamJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      next: { revalidate: CACHE_REVALIDATE_S },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UpstreamFetchError('timeout', url, `Upstream timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new UpstreamFetchError('network', url, `Network error: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new UpstreamFetchError(
      'http',
      url,
      `Upstream responded ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UpstreamFetchError('parse', url, `Invalid JSON from upstream: ${msg}`);
  }
}

// ─── PocketBase record shape ─────────────────────────────────────────────────

/**
 * Minimal shape we read off a PB `script_scripts` record with
 * `expand=categories,type`. PocketBase ships many extra fields (`created`,
 * `updated`, `collectionId`, …) but they're not relevant to the UI.
 */
interface PBExpandedType {
  /** Type slug — "lxc" | "vm" | "pve" | "addon" | "turnkey" | … */
  type: string;
}

interface PBExpandedCategory {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  sort_order?: number;
}

interface PBInstallMethod {
  type: string;
  script?: string | null;
  config_path?: string | null;
  resources: {
    cpu: number;
    ram: number;
    hdd: number;
    os: string;
    version: string;
  };
}

interface PBNote {
  text: string;
  type: string;
}

interface PBScriptRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  type: string;
  port: number | null;
  updateable: boolean;
  privileged: boolean;
  has_arm: boolean;
  is_dev: boolean;
  is_disabled: boolean;
  is_deleted: boolean;
  website: string | null;
  documentation: string | null;
  github: string | null;
  script_created: string;
  script_updated: string;
  config_path: string | null;
  default_user: string | null;
  default_passwd: string | null;
  install_methods: PBInstallMethod[];
  notes: PBNote[];
  execute_in: string[];
  expand?: {
    type?: PBExpandedType;
    categories?: PBExpandedCategory[];
  };
}

interface PBListResponse<T> {
  page: number;
  perPage: number;
  totalPages: number;
  totalItems: number;
  items: T[];
}

// ─── PB → CommunityScript mappers ────────────────────────────────────────────

/**
 * Collapse the upstream type slug (lxc/vm/pve/addon/turnkey/…) into the
 * four-member union the UI is typed against. `lxc` is the real name in
 * PocketBase but `ct` is the term the rest of Proxmox (and our UI) uses.
 */
function mapTypeSlug(raw: string | undefined): CommunityScript['type'] {
  switch ((raw ?? '').toLowerCase()) {
    case 'lxc':
    case 'ct':
      return 'ct';
    case 'vm':
      return 'vm';
    case 'addon':
      return 'addon';
    default:
      // pve / turnkey / misc / anything unknown — surface as "misc" so the
      // UI still renders rather than narrowing to `never`.
      return 'misc';
  }
}

/**
 * Map a PB install-method entry to the shape the UI consumes, resolving the
 * script path and full URL against the main ProxmoxVE repo. Upstream leaves
 * `install_methods[].script` as `null` on modern records and expects
 * consumers to derive the path from (type, method.type, slug).
 *
 * Derivation rules, by method.type:
 *   default  → <type-dir>/<slug>.sh
 *   alpine   → ct/alpine-<slug>.sh              (LXC-only; upstream
 *                                                 ships alpine variants under
 *                                                 a prefixed filename in ct/)
 *   other    → <type-dir>/<method.type>-<slug>.sh
 *
 * <type-dir> comes from the parent type slug:
 *   lxc        → ct
 *   vm         → vm
 *   addon      → addon
 *   turnkey    → turnkey
 *   pve / misc → misc
 */
function resolveInstallMethod(
  method: PBInstallMethod,
  slug: string,
  typeSlug: string,
): InstallMethod {
  const typeDir = typeDirFor(typeSlug);
  const scriptPath =
    method.script && typeof method.script === 'string' && method.script.length > 0
      ? method.script.replace(/^\/+/, '')
      : buildScriptPath(typeDir, slug, method.type);
  return {
    type: method.type,
    resources: method.resources,
    scriptPath,
    scriptUrl: `${REPO_RAW_BASE}/${scriptPath}`,
    config_path: method.config_path ?? null,
  };
}

/**
 * Map a PocketBase type slug to the directory inside the main ProxmoxVE
 * repo that holds its install scripts. Verified against the live repo on
 * 2026-04-17:
 *
 *   lxc / ct → ct/<slug>.sh                  (+ ct/alpine-<slug>.sh)
 *   vm       → vm/<slug>.sh                  (slug already carries -vm suffix)
 *   addon    → tools/addon/<slug>.sh         (NOT addon/, that dir doesn't exist)
 *   turnkey  → turnkey/<slug>.sh
 *   pve      → tools/pve/<slug>.sh           (NOT misc/, that dir holds shared .func files)
 *   misc/*   → tools/pve/<slug>.sh           (safe default — unknown types fall
 *                                              through here; tools/pve is the
 *                                              broadest bucket upstream uses)
 */
function typeDirFor(typeSlug: string): string {
  switch (typeSlug.toLowerCase()) {
    case 'lxc':
    case 'ct':
      return 'ct';
    case 'vm':
      return 'vm';
    case 'addon':
      return 'tools/addon';
    case 'turnkey':
      return 'turnkey';
    case 'pve':
    case 'misc':
    default:
      return 'tools/pve';
  }
}

function buildScriptPath(typeDir: string, slug: string, methodType: string): string {
  if (!methodType || methodType === 'default') return `${typeDir}/${slug}.sh`;
  // The alpine variant always lives under ct/ even when the default is a VM;
  // that said, upstream has always kept alpine variants as LXC, so no VM path
  // prefix is needed here.
  if (methodType === 'alpine') return `ct/alpine-${slug}.sh`;
  return `${typeDir}/${methodType}-${slug}.sh`;
}

function mapNotes(notes: PBNote[] | undefined): ScriptNote[] {
  if (!Array.isArray(notes)) return [];
  return notes.map((n) => ({
    text: n.text,
    // PB sometimes ships "warn" shorthand; normalise to the canonical union.
    type:
      n.type === 'warning' || n.type === 'warn'
        ? 'warning'
        : n.type === 'danger' || n.type === 'error'
          ? 'danger'
          : 'info',
  }));
}

function recordToScript(record: PBScriptRecord): CommunityScript {
  const typeSlugRaw = record.expand?.type?.type ?? '';
  const type = mapTypeSlug(typeSlugRaw);
  const categories = (record.expand?.categories ?? []).map((c) => c.name);
  const primaryCategory = categories[0] ?? 'Misc';

  const methods = (record.install_methods ?? []).map((m) =>
    resolveInstallMethod(m, record.slug, typeSlugRaw),
  );
  // Default method is our source of truth for scriptUrl + resources; fall
  // back to the first method if upstream ever omits "default".
  const defaultMethod =
    methods.find((m) => m.type === 'default') ?? methods[0] ?? null;

  const scriptUrl =
    defaultMethod?.scriptUrl ??
    `${REPO_RAW_BASE}/${typeDirFor(typeSlugRaw)}/${record.slug}.sh`;

  const defaultCreds =
    record.default_user || record.default_passwd
      ? {
          username: record.default_user ?? undefined,
          password: record.default_passwd ?? undefined,
        }
      : undefined;

  return {
    name: record.name,
    slug: record.slug,
    description: record.description,
    category: primaryCategory,
    categories,
    type,
    scriptUrl,
    logo: record.logo ?? undefined,
    port: record.port,
    updateable: Boolean(record.updateable),
    privileged: Boolean(record.privileged),
    has_arm: Boolean(record.has_arm),
    website: record.website,
    documentation: record.documentation,
    github: record.github,
    install_methods: methods,
    execute_in: record.execute_in ?? [],
    default_credentials: defaultCreds,
    notes: mapNotes(record.notes),
    resources: defaultMethod
      ? {
          cpu: defaultMethod.resources.cpu,
          ram: defaultMethod.resources.ram,
          // The UI expects hdd as a human-readable string ("2 GB"), while PB
          // ships it as a bare GB integer. Render at the boundary so the UI
          // doesn't have to know the unit convention.
          hdd: `${defaultMethod.resources.hdd} GB`,
          os: defaultMethod.resources.os,
          version: defaultMethod.resources.version,
        }
      : undefined,
    date_created: record.script_created || undefined,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Common filter predicate — hide deleted, disabled, and dev-only scripts
 * from the public listing. PB's `filter=` uses a JS-ish mini-language with
 * single quotes for string literals and `&&` / `||` / `=` operators.
 */
const PB_PUBLIC_FILTER = "(is_deleted=false && is_disabled=false && is_dev=false)";

/**
 * Fetch the full script index. Pages through PocketBase until every record
 * is collected — the dataset is small (~500) so a single page at
 * perPage=500 almost always suffices, but we still loop in case upstream
 * grows or lowers the page cap.
 *
 * `empty` is an error rather than an empty array because the only way to
 * legitimately get zero scripts is a provisioning bug upstream; callers
 * want to render that as 502, not as "no results".
 */
export async function fetchScriptIndex(): Promise<CommunityScript[]> {
  const collected: CommunityScript[] = [];
  let page = 1;
  // Cap the loop at 20 pages × 500/page = 10 000 records — well above the
  // realistic ceiling, defence against a pathological upstream reply that
  // would otherwise loop forever.
  const maxPages = 20;

  while (page <= maxPages) {
    const url =
      `${SCRIPTS_COLLECTION}?page=${page}&perPage=${PB_PAGE_SIZE}` +
      `&expand=categories,type&sort=name` +
      `&filter=${encodeURIComponent(PB_PUBLIC_FILTER)}`;

    const body = await fetchUpstreamJSON<PBListResponse<PBScriptRecord>>(url);
    for (const rec of body.items ?? []) {
      collected.push(recordToScript(rec));
    }
    if (!body.items || body.items.length < PB_PAGE_SIZE) break;
    page += 1;
  }

  if (collected.length === 0) {
    throw new UpstreamFetchError(
      'empty',
      SCRIPTS_COLLECTION,
      'PocketBase responded but returned zero scripts',
    );
  }
  return collected;
}

/**
 * Fetch the manifest for a single script slug. Returns `null` when the slug
 * is unknown (PocketBase returns an empty `items` array rather than a 404);
 * network / upstream errors propagate as UpstreamFetchError so the route
 * handler can 502 vs. 404 appropriately.
 */
export async function fetchScriptManifest(slug: string): Promise<ScriptManifest | null> {
  // Mirror the API route's slug regex one more time — defence in depth:
  // even if an upstream consumer skips validation, we refuse to interpolate
  // arbitrary input into PB's filter mini-language. PB's filter() helper
  // normally escapes for us but we're building the query as a raw string.
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }

  // PB's filter string literals use single quotes; our slug regex already
  // rules out quotes, backslashes, and whitespace, so direct interpolation
  // is safe. We still wrap in encodeURIComponent for the URL layer.
  const filter = `(slug='${slug}')`;
  const url =
    `${SCRIPTS_COLLECTION}?page=1&perPage=1&expand=categories,type` +
    `&filter=${encodeURIComponent(filter)}`;

  const body = await fetchUpstreamJSON<PBListResponse<PBScriptRecord>>(url);
  const record = body.items?.[0];
  if (!record) return null;
  return recordToScript(record);
}

/**
 * Group a flat script list by (primary) category. Pure function — called by
 * /api/scripts?grouped=1 after a successful fetchScriptIndex().
 */
export function groupByCategory(scripts: CommunityScript[]): ScriptCategory[] {
  const buckets = new Map<string, CommunityScript[]>();
  for (const s of scripts) {
    const cat = s.category || 'Misc';
    const list = buckets.get(cat);
    if (list) list.push(s);
    else buckets.set(cat, [s]);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      scripts: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

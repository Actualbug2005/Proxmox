/**
 * Community Scripts fetcher
 * Upstream: https://github.com/community-scripts/ProxmoxVE
 *
 * Layout of the upstream repo:
 *   json/<slug>.json               — individual script manifest
 *   website/src/data/scripts.json  — aggregated index consumed by the
 *                                     official website (our primary source)
 *   ct/<slug>.sh                   — LXC install script
 *   vm/<slug>.sh                   — VM install script
 *   addon/<slug>.sh                — addon install script
 *
 * Phase D design notes:
 *   - The single source of truth for the UI contract is CommunityScript
 *     (re-exported unchanged from @/types/proxmox). Do not rename it —
 *     existing consumers (app/scripts/page.tsx, run route) rely on the
 *     shape.
 *   - The new ScriptCategory / ScriptManifest / ScriptOption interfaces
 *     below are STRUCTURAL enrichments, not replacements. They give
 *     API consumers a categorised envelope and expose the per-script
 *     metadata shape that the upstream json/*.json files actually ship.
 *   - All upstream IO goes through fetchUpstreamJSON(), which classifies
 *     failures into a discriminated FetchError union so the API layer can
 *     map them to correct HTTP status codes (502 vs 504 vs 500).
 */

import type { CommunityScript } from '@/types/proxmox';

export type { CommunityScript };

const RAW_BASE = 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main';
const GITHUB_API_BASE = 'https://api.github.com/repos/community-scripts/ProxmoxVE';
const WEBSITE_INDEX_URL = `${RAW_BASE}/website/src/data/scripts.json`;
const CACHE_REVALIDATE_S = 3600;
const FETCH_TIMEOUT_MS = 10_000;

// ─── Public interfaces ───────────────────────────────────────────────────────

/**
 * One user-configurable option declared by a script manifest — e.g.
 * "password", "hostname", "storage pool". Matches the shape used inside
 * the upstream json/<slug>.json files.
 */
export interface ScriptOption {
  /** Field name as presented to the user (e.g. "Hostname"). */
  label: string;
  /** Internal parameter key the script consumes. */
  name: string;
  /** Input widget type. Upstream only uses a small enumerated set. */
  type: 'string' | 'number' | 'boolean' | 'password' | 'select';
  /** Default pre-fill value. */
  default?: string | number | boolean;
  /** When type === 'select', the allowed values. */
  choices?: string[];
  /** When true, the option cannot be empty. */
  required?: boolean;
  /** Human description shown as helper text. */
  description?: string;
}

/**
 * Full manifest for a single script. This is a superset of CommunityScript
 * (which is the summary shape the list endpoint returns). The manifest is
 * what the /api/scripts/[slug] detail endpoint will return once we wire
 * it up — for now it's exported so the run route and the eventual
 * option-form UI share a single contract.
 */
export interface ScriptManifest extends CommunityScript {
  /** Parameters the caller can override when running the script. */
  options?: ScriptOption[];
  /** Upstream-declared install command URL (ct/vm/addon shell). */
  install?: string;
  /** Upstream-declared update command URL (when supported). */
  updateable?: boolean;
  /** Upstream website URL for docs. */
  website?: string;
  /** Upstream documentation URL. */
  documentation?: string;
  /** Logo/icon path relative to the upstream repo. */
  logo?: string;
}

/**
 * A named grouping of scripts. The API's `?grouped=1` envelope returns
 * an array of these so the UI can render collapsible sections without
 * re-grouping client-side.
 */
export interface ScriptCategory {
  /** Canonical category name (e.g. "Network", "Databases"). */
  name: string;
  /** Slugified form of `name` suitable for URL fragments. */
  slug: string;
  /** Scripts belonging to this category, sorted alphabetically by name. */
  scripts: CommunityScript[];
}

// ─── Structured fetch errors ─────────────────────────────────────────────────

/**
 * Discriminated union that the API route maps to HTTP status codes:
 *
 *   timeout         → 504 Gateway Timeout
 *   network         → 502 Bad Gateway (no response at all)
 *   http            → 502 Bad Gateway (upstream returned non-2xx)
 *   parse           → 502 Bad Gateway (response wasn't valid JSON/shape)
 *   empty           → 502 Bad Gateway (upstream returned []/null)
 */
export type FetchErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'empty';

export class UpstreamFetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly status?: number;
  readonly url: string;

  constructor(kind: FetchErrorKind, url: string, message: string, status?: number) {
    super(message);
    this.name = 'UpstreamFetchError';
    this.kind = kind;
    this.status = status;
    this.url = url;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Wrap fetch with an AbortController-based timeout and classify every
 * failure mode into an UpstreamFetchError. The caller always gets back a
 * JSON-parsed body on success; every other outcome throws.
 *
 * Next.js fetch semantics: the { next: { revalidate } } directive lets
 * the runtime share a cached response across requests for up to an hour.
 * Since the upstream repo refreshes at most a few times per day, that's
 * the right trade-off between freshness and avoiding rate-limiting on
 * GitHub's raw CDN.
 */
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

function buildInstallUrl(slug: string, type: string): string {
  if (type === 'vm') return `${RAW_BASE}/vm/${slug}.sh`;
  if (type === 'addon') return `${RAW_BASE}/addon/${slug}.sh`;
  return `${RAW_BASE}/ct/${slug}.sh`;
}

function coerceType(raw: unknown): CommunityScript['type'] {
  const s = String(raw ?? 'ct').toLowerCase();
  return (['ct', 'vm', 'misc', 'addon'].includes(s) ? s : 'ct') as CommunityScript['type'];
}

function parseWebsiteJson(data: unknown): CommunityScript[] {
  if (!Array.isArray(data)) return [];

  const out: CommunityScript[] = [];
  for (const item of data as Record<string, unknown>[]) {
    const slug = String(item.slug ?? item.nsapp ?? '').trim();
    if (!slug) continue;
    const type = coerceType(item.type);

    const script: CommunityScript = {
      name: String(item.name ?? slug),
      slug,
      description: String(item.description ?? ''),
      category: String(
        (item.categories as string[] | undefined)?.[0] ?? item.category ?? 'Misc',
      ),
      type,
      author: String(item.author ?? ''),
      tags: (item.tags as string[] | undefined) ?? [],
      scriptUrl: buildInstallUrl(slug, type),
      jsonUrl: `${RAW_BASE}/json/${slug}.json`,
      nsapp: String(item.nsapp ?? slug),
      date_created: item.date_created as string | undefined,
      default_credentials: item.default_credentials as CommunityScript['default_credentials'],
      notes: (item.notes as string[] | undefined) ?? [],
      resources: item.resources as CommunityScript['resources'],
    };
    out.push(script);
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the flat script index from the upstream repo.
 *
 * Strategy:
 *   1. Try the website JSON (richest metadata) with explicit timeout and
 *      classified errors.
 *   2. If the website JSON 404s or times out AND the GitHub tree API
 *      responds, synthesise a bare index from the file tree. This fallback
 *      returns Scripts with empty descriptions but correct slugs/urls.
 *   3. If both upstream reads fail, re-throw the original website-JSON
 *      error so the API layer sees the real root cause.
 *   4. If both succeed but return no entries, throw an 'empty' error —
 *      callers want to surface that as 502 rather than render an empty UI.
 */
export async function fetchScriptIndex(): Promise<CommunityScript[]> {
  let websiteErr: UpstreamFetchError | null = null;

  try {
    const data = await fetchUpstreamJSON<unknown>(WEBSITE_INDEX_URL);
    const scripts = parseWebsiteJson(data);
    if (scripts.length > 0) return scripts;
    websiteErr = new UpstreamFetchError(
      'empty',
      WEBSITE_INDEX_URL,
      'Website JSON parsed but yielded zero scripts',
    );
  } catch (err) {
    if (err instanceof UpstreamFetchError) websiteErr = err;
    else throw err;
  }

  // Fallback: synthesise a bare index from the GitHub tree API.
  try {
    const tree = await fetchUpstreamJSON<{ tree?: { path: string; type: string }[] }>(
      `${GITHUB_API_BASE}/git/trees/main?recursive=1`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    const entries = tree.tree ?? [];
    const ctScripts: CommunityScript[] = entries
      .filter((f) => f.path.startsWith('ct/') && f.path.endsWith('.sh'))
      .map((f) => {
        const slug = f.path.replace(/^ct\//, '').replace(/\.sh$/, '');
        return {
          name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          slug,
          description: '',
          category: 'CT Scripts',
          type: 'ct' as const,
          scriptUrl: `${RAW_BASE}/ct/${slug}.sh`,
          jsonUrl: `${RAW_BASE}/json/${slug}.json`,
        };
      });

    if (ctScripts.length > 0) return ctScripts;
    // Fallback succeeded but returned nothing — surface the original error.
    throw websiteErr ?? new UpstreamFetchError('empty', WEBSITE_INDEX_URL, 'No scripts found');
  } catch (err) {
    // Prefer the primary error if the fallback also failed; it's more
    // diagnostically useful than a secondary tree-API failure.
    if (websiteErr) throw websiteErr;
    throw err;
  }
}

/**
 * Fetch the full manifest for a single script. Errors propagate as
 * UpstreamFetchError so the caller can decide between 404 (missing
 * manifest) and 502 (upstream unreachable).
 */
export async function fetchScriptManifest(slug: string): Promise<ScriptManifest | null> {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  const url = `${RAW_BASE}/json/${slug}.json`;

  let data: Record<string, unknown>;
  try {
    data = await fetchUpstreamJSON<Record<string, unknown>>(url);
  } catch (err) {
    if (err instanceof UpstreamFetchError && err.kind === 'http' && err.status === 404) {
      return null;
    }
    throw err;
  }

  const type = coerceType(data.type);
  return {
    name: String(data.name ?? slug),
    slug,
    description: String(data.description ?? ''),
    category: String(
      (data.categories as string[] | undefined)?.[0] ?? data.category ?? 'Misc',
    ),
    type,
    author: (data.author as string | undefined) ?? '',
    tags: (data.tags as string[] | undefined) ?? [],
    scriptUrl: buildInstallUrl(slug, type),
    jsonUrl: url,
    nsapp: (data.nsapp as string | undefined) ?? slug,
    date_created: data.date_created as string | undefined,
    default_credentials: data.default_credentials as CommunityScript['default_credentials'],
    notes: (data.notes as string[] | undefined) ?? [],
    resources: data.resources as CommunityScript['resources'],
    options: (data.options as ScriptOption[] | undefined) ?? undefined,
    install: (data.install as string | undefined) ?? undefined,
    updateable: (data.updateable as boolean | undefined) ?? undefined,
    website: (data.website as string | undefined) ?? undefined,
    documentation: (data.documentation as string | undefined) ?? undefined,
    logo: (data.logo as string | undefined) ?? undefined,
  };
}

/**
 * Group a flat script list into ScriptCategory[] sorted by category name,
 * with each category's scripts sorted alphabetically. Pure function — the
 * API route calls this after a successful fetchScriptIndex().
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
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      scripts: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * @deprecated Prefer fetchScriptManifest() for the full typed payload.
 * Retained because the run route currently imports it under the old name.
 */
export async function fetchScriptDetail(slug: string): Promise<Partial<CommunityScript>> {
  const manifest = await fetchScriptManifest(slug).catch(() => null);
  if (!manifest) return {};
  return {
    default_credentials: manifest.default_credentials,
    notes: manifest.notes,
    resources: manifest.resources,
    description: manifest.description,
  };
}

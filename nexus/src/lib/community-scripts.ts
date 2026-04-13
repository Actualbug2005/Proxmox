/**
 * Community Scripts fetcher
 * Source: https://github.com/community-scripts/ProxmoxVE
 *
 * The repo exposes a JSON index at:
 *   https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/json/app-versions.json
 *
 * Individual script metadata lives at:
 *   https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/json/<slug>.json
 *
 * Install scripts live at:
 *   https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/install/<slug>-install.sh
 * or
 *   https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/<slug>.sh
 */

import type { CommunityScript } from '@/types/proxmox';

const RAW_BASE = 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main';
const GITHUB_API_BASE = 'https://api.github.com/repos/community-scripts/ProxmoxVE';

export interface ScriptIndexEntry {
  name: string;
  slug: string;
  type: string;
  description?: string;
  categories?: string[];
  date_created?: string;
  json?: string;
  install_script?: string;
}

// The repo has a website JSON that lists all scripts
const WEBSITE_JSON_URL = `${RAW_BASE}/json/app-versions.json`;

/**
 * Fetch the flat list of all available scripts from the website JSON.
 * Falls back to the GitHub API tree listing if the JSON isn't available.
 */
export async function fetchScriptIndex(): Promise<CommunityScript[]> {
  try {
    // Primary: fetch the detailed JSON index from the repo
    const res = await fetch(`${RAW_BASE}/website/src/data/scripts.json`, {
      next: { revalidate: 3600 },
    });

    if (res.ok) {
      const data = await res.json();
      return parseWebsiteJson(data);
    }
  } catch {
    // fall through to GitHub API
  }

  // Fallback: use GitHub API to list ct/ and install/ directories
  return fetchFromGitHubAPI();
}

function parseWebsiteJson(data: unknown[]): CommunityScript[] {
  if (!Array.isArray(data)) return [];

  return (data as Record<string, unknown>[]).map((item) => {
    const slug = String(item.slug ?? item.nsapp ?? '');
    const type = String(item.type ?? 'ct').toLowerCase() as CommunityScript['type'];

    return {
      name: String(item.name ?? slug),
      slug,
      description: String(item.description ?? ''),
      category: String((item.categories as string[])?.[0] ?? item.category ?? 'Misc'),
      type: (['ct', 'vm', 'misc', 'addon'].includes(type) ? type : 'ct') as CommunityScript['type'],
      author: String(item.author ?? ''),
      tags: (item.tags as string[]) ?? [],
      scriptUrl: buildInstallUrl(slug, type),
      jsonUrl: `${RAW_BASE}/json/${slug}.json`,
      nsapp: String(item.nsapp ?? slug),
      date_created: item.date_created as string | undefined,
      default_credentials: item.default_credentials as CommunityScript['default_credentials'],
      notes: (item.notes as string[]) ?? [],
      resources: item.resources as CommunityScript['resources'],
    };
  });
}

function buildInstallUrl(slug: string, type: string): string {
  if (type === 'vm') return `${RAW_BASE}/vm/${slug}.sh`;
  if (type === 'addon') return `${RAW_BASE}/addon/${slug}.sh`;
  // Check both install/ and ct/ patterns
  return `${RAW_BASE}/ct/${slug}.sh`;
}

async function fetchFromGitHubAPI(): Promise<CommunityScript[]> {
  const res = await fetch(`${GITHUB_API_BASE}/git/trees/main?recursive=1`, {
    headers: { Accept: 'application/vnd.github+json' },
    next: { revalidate: 3600 },
  });

  if (!res.ok) return [];

  const data = await res.json();
  const tree: { path: string; type: string }[] = data.tree ?? [];

  const ctScripts = tree
    .filter((f) => f.path.startsWith('ct/') && f.path.endsWith('.sh'))
    .map((f) => {
      const slug = f.path.replace('ct/', '').replace('.sh', '');
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

  return ctScripts;
}

export async function fetchScriptDetail(slug: string): Promise<Partial<CommunityScript>> {
  try {
    const res = await fetch(`${RAW_BASE}/json/${slug}.json`);
    if (res.ok) {
      const data = await res.json();
      return {
        default_credentials: data.default_credentials,
        notes: data.notes,
        resources: data.resources,
        description: data.description,
      };
    }
  } catch {
    // ignore
  }
  return {};
}

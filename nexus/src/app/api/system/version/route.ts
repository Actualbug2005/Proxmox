/**
 * Version + update-availability probe.
 *
 * GET /api/system/version
 *   → { current, latest, updateAvailable, publishedAt?, releaseUrl?, releaseNotes? }
 *
 * "current" is read from the VERSION file baked into the active release
 * tarball (see .github/workflows/release.yml). "latest" is fetched from
 * GitHub's /releases/latest API with a 60-second in-memory cache so the
 * Nexus UI can poll this endpoint without hammering the GitHub rate limit.
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { withAuth } from '@/lib/route-middleware';

const REPO = process.env.NEXUS_REPO ?? 'Actualbug2005/Proxmox';
const VERSION_FILE = process.env.NEXUS_VERSION_FILE ?? '/opt/nexus/current/VERSION';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_MS = 60_000;

interface LatestRelease {
  tag: string;
  publishedAt: string;
  url: string;
  notes: string;
}

let cached: { at: number; data: LatestRelease | null } | null = null;

async function readCurrentVersion(): Promise<string> {
  try {
    return (await readFile(VERSION_FILE, 'utf8')).trim() || 'unknown';
  } catch {
    // File missing when running from a git clone (dev) or before first install.
    return 'dev';
  }
}

async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.data;

  try {
    const res = await fetch(GITHUB_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `nexus/${REPO}`,
      },
      // Don't let a slow GitHub response block the UI longer than necessary.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      cached = { at: now, data: null };
      return null;
    }
    const json = (await res.json()) as {
      tag_name?: string;
      published_at?: string;
      html_url?: string;
      body?: string;
    };
    const data: LatestRelease = {
      tag: json.tag_name ?? '',
      publishedAt: json.published_at ?? '',
      url: json.html_url ?? '',
      notes: json.body ?? '',
    };
    cached = { at: now, data };
    return data;
  } catch {
    cached = { at: now, data: null };
    return null;
  }
}

export const GET = withAuth(async () => {
  const [current, latest] = await Promise.all([readCurrentVersion(), fetchLatestRelease()]);

  const updateAvailable =
    latest !== null && latest.tag !== '' && current !== latest.tag && current !== 'dev';

  return NextResponse.json(
    {
      current,
      latest: latest?.tag ?? null,
      updateAvailable,
      publishedAt: latest?.publishedAt ?? null,
      releaseUrl: latest?.url ?? null,
      releaseNotes: latest?.notes ?? null,
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

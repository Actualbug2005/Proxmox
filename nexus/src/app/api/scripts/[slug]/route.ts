/**
 * GET /api/scripts/[slug] — Script manifest detail
 *
 * Returns the full ScriptManifest for a single slug, including the
 * options[] array the UI renders as a dynamic form. Error mapping
 * mirrors the index route:
 *
 *   timeout                           → 504
 *   network | http | parse            → 502
 *   manifest missing (upstream 404)   → 404
 *   invalid slug                      → 400
 */
import { NextResponse } from 'next/server';
import {
  fetchScriptManifest,
  UpstreamFetchError,
  type ScriptManifest,
} from '@/lib/community-scripts';
import { getSession } from '@/lib/auth';

// Slug must match the upstream filename convention. The community-scripts
// repo uses strict lowercase kebab-case (e.g. `adguard-home`, `ubuntu-22-04`),
// so the regex doesn't need to allow dots, underscores, or uppercase.
// Length capped at 63 (one DNS label) to prevent pathological inputs that
// could bloat logs or downstream error messages.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

interface Ctx {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await ctx.params;
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
  }

  let manifest: ScriptManifest | null;
  try {
    manifest = await fetchScriptManifest(slug);
  } catch (err) {
    if (err instanceof UpstreamFetchError) {
      const status = err.kind === 'timeout' ? 504 : 502;
      return NextResponse.json(
        {
          error: 'Failed to fetch script manifest',
          kind: err.kind,
          detail: err.message,
          upstreamStatus: err.status ?? null,
          upstreamUrl: err.url,
        },
        { status },
      );
    }
    console.error('[api/scripts/[slug]] unexpected error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  if (!manifest) {
    return NextResponse.json(
      { error: `Manifest not found for slug "${slug}"` },
      { status: 404 },
    );
  }
  return NextResponse.json(manifest);
}

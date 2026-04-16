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

// Slug must match the upstream filename convention exactly: lowercase
// letters/digits, plus dot/underscore/hyphen. No slashes — that would
// let the request escape the json/ directory. The library already does
// this validation; duplicating it here lets us 400 before making any
// upstream call, saving latency on bad requests.
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

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

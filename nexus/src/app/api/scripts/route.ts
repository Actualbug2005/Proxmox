/**
 * Community scripts index — GET /api/scripts
 *
 * Shape contract:
 *   - Default:               CommunityScript[]           (flat; UI-compatible)
 *   - ?grouped=1:            GroupedEnvelope             (categorised)
 *
 * Error mapping (from UpstreamFetchError.kind):
 *   - timeout                  → 504 Gateway Timeout
 *   - network | http | parse | empty → 502 Bad Gateway
 * The response body always carries a diagnostic detail so the UI can
 * render a specific failure message rather than a generic "fetch failed".
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchScriptIndex,
  groupByCategory,
  UpstreamFetchError,
  type CommunityScript,
  type ScriptCategory,
} from '@/lib/community-scripts';
import { getSession } from '@/lib/auth';

// Exported so the UI can `import type` this instead of re-declaring the
// envelope shape. The categorised envelope is the canonical v2 contract;
// the flat CommunityScript[] default remains for any unversioned consumer.
export interface GroupedEnvelope {
  categories: ScriptCategory[];
  meta: {
    source: 'community-scripts/ProxmoxVE';
    fetchedAt: string;
    count: number;
    categoryCount: number;
  };
}

function errorResponse(err: unknown) {
  if (err instanceof UpstreamFetchError) {
    const status = err.kind === 'timeout' ? 504 : 502;
    return NextResponse.json(
      {
        error: 'Failed to fetch community scripts',
        kind: err.kind,
        detail: err.message,
        upstreamStatus: err.status ?? null,
        upstreamUrl: err.url,
      },
      { status },
    );
  }
  // Unexpected — don't leak internals, log server-side and 500.
  console.error('[api/scripts] unexpected error', err);
  return NextResponse.json(
    { error: 'Internal error fetching scripts' },
    { status: 500 },
  );
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let scripts: CommunityScript[];
  try {
    scripts = await fetchScriptIndex();
  } catch (err) {
    return errorResponse(err);
  }

  // Query param honours the current UI's flat-array contract by default
  // while letting future consumers opt into the categorised envelope
  // without a second fetch. (?grouped=1 is explicit; any other value is
  // treated as flat.)
  const grouped = req.nextUrl.searchParams.get('grouped') === '1';
  if (!grouped) {
    return NextResponse.json(scripts);
  }

  const categories = groupByCategory(scripts);
  const envelope: GroupedEnvelope = {
    categories,
    meta: {
      source: 'community-scripts/ProxmoxVE',
      fetchedAt: new Date().toISOString(),
      count: scripts.length,
      categoryCount: categories.length,
    },
  };
  return NextResponse.json(envelope);
}

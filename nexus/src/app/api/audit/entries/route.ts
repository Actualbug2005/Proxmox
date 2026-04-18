/**
 * GET /api/audit/entries — SAFE-tier audit log reader.
 *
 * Streams newline-delimited JSON entries from the SAFE tier
 * (/var/log/nexus/exec.jsonl by default, env-overridable). No decryption
 * happens here — the SECRET tier (command ciphertext) is intentionally
 * NOT reachable from the app, because the private key must never touch
 * the running host (see SECURITY.md §"Operator responsibilities"). Open
 * the paired entry off-box with `scripts/nexus-audit-decrypt.ts` when
 * you need the full command text.
 *
 * Filter params (all optional):
 *   ?user=root@pam
 *   ?endpoint=exec | scripts.run
 *   ?node=pve
 *   ?since=ISO8601
 *   ?until=ISO8601
 *   ?limit=1..500   (default 200)
 *
 * Filtering happens server-side after read so the response can stay
 * capped — even on a multi-GB log, the route reads the file once and
 * shortcuts when it has enough matches, newest-first.
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { withAuth } from '@/lib/route-middleware';
import { AUDIT_PATHS, type SafeEntry } from '@/lib/exec-audit';
import { selectEntries, type EntryFilter } from './filter';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseFilter(url: URL): EntryFilter | { error: string } {
  const f: EntryFilter = {};
  const user = url.searchParams.get('user');
  if (user) f.user = user;
  const endpoint = url.searchParams.get('endpoint');
  if (endpoint) {
    if (endpoint !== 'exec' && endpoint !== 'scripts.run') {
      return { error: `Unknown endpoint: ${endpoint}` };
    }
    f.endpoint = endpoint;
  }
  const node = url.searchParams.get('node');
  if (node) f.node = node;
  const since = url.searchParams.get('since');
  if (since) {
    const t = Date.parse(since);
    if (Number.isNaN(t)) return { error: `Bad since: ${since}` };
    f.sinceMs = t;
  }
  const until = url.searchParams.get('until');
  if (until) {
    const t = Date.parse(until);
    if (Number.isNaN(t)) return { error: `Bad until: ${until}` };
    f.untilMs = t;
  }
  return f;
}

export interface AuditEntriesResponse {
  entries: SafeEntry[];
  truncated: boolean;
  total: number;
  path: string;
}

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const parsed = parseFilter(url);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit
    ? Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(rawLimit, 10) || DEFAULT_LIMIT))
    : DEFAULT_LIMIT;

  let text: string;
  try {
    text = await readFile(AUDIT_PATHS.safe, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // No log file yet — empty (not an error). Operators see "no entries"
      // in the UI rather than a 500.
      return NextResponse.json<AuditEntriesResponse>({
        entries: [],
        truncated: false,
        total: 0,
        path: AUDIT_PATHS.safe,
      });
    }
    return NextResponse.json(
      { error: 'Failed to read audit log', detail: String(err) },
      { status: 500 },
    );
  }

  const { entries, total } = selectEntries(text, parsed, limit);

  return NextResponse.json<AuditEntriesResponse>(
    { entries, truncated: total > entries.length, total, path: AUDIT_PATHS.safe },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

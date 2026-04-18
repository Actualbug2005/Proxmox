/**
 * Read-only file browser for a registered NAS share.
 *
 *   GET /api/nas/browse?node=<name>&shareId=<b64url>&path=<rel>
 *
 * Returns a single directory level: `{ files: FileNode[] }`.
 *
 * Auth chain:
 *   1. Valid Nexus session.
 *   2. Caller holds Sys.Audit on /nodes/<node>  (read-only endpoint, no
 *      CSRF needed for GET).
 *
 * Traversal defenses (belt-and-braces):
 *   • Route:    rejects path containing ".." or leading "/" before it
 *               ever reaches the provider.
 *   • Provider: same check + realpath-prefix verification inside the
 *               remote shell script.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { requireNodeSysAudit } from '@/lib/permissions';
import { NODE_RE } from '@/lib/remote-shell';
import { getNasProvider } from '@/lib/nas/registry';

export const GET = withAuth(async (req, { session }) => {
  const node = req.nextUrl.searchParams.get('node') ?? '';
  const shareId = req.nextUrl.searchParams.get('shareId') ?? '';
  const path = req.nextUrl.searchParams.get('path') ?? '';

  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }
  // base64url alphabet — prevents arbitrary string pass-through.
  if (!shareId || !/^[A-Za-z0-9_-]+=*$/.test(shareId)) {
    return NextResponse.json({ error: 'Invalid or missing shareId' }, { status: 400 });
  }
  if (path.includes('..') || path.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  if (!(await requireNodeSysAudit(session, node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Audit required on /nodes/${node}` },
      { status: 403 },
    );
  }

  try {
    const files = await getNasProvider(node).listDirectory(node, shareId, path);
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});

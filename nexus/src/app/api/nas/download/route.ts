/**
 * Streamed file download from a registered NAS share.
 *
 *   GET /api/nas/download?node=<name>&shareId=<b64url>&path=<rel>
 *
 * Tunnels the remote `cat` output through Next.js as a Web ReadableStream —
 * no server-side buffering, so multi-gigabyte files transit on ~O(1) memory.
 *
 * Auth: session + Sys.Audit on /nodes/<node>. Same gate as the browse
 * endpoint — this is a read, not a mutation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requireNodeSysAudit } from '@/lib/permissions';
import { NODE_RE } from '@/lib/remote-shell';
import { getNasProvider } from '@/lib/nas/registry';

/**
 * RFC 6266 filename encoding for Content-Disposition.
 *   filename="<ascii-safe>"          — fallback for ancient clients.
 *   filename*=UTF-8''<percent-enc>   — proper encoding that every modern
 *                                      browser prefers over the basic form.
 */
function formatContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[\\"]/g, '_').replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const node = req.nextUrl.searchParams.get('node') ?? '';
  const shareId = req.nextUrl.searchParams.get('shareId') ?? '';
  const path = req.nextUrl.searchParams.get('path') ?? '';

  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }
  if (!shareId || !/^[A-Za-z0-9_-]+=*$/.test(shareId)) {
    return NextResponse.json({ error: 'Invalid or missing shareId' }, { status: 400 });
  }
  if (!path || path.includes('..') || path.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid or missing path' }, { status: 400 });
  }

  if (!(await requireNodeSysAudit(session, node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Audit required on /nodes/${node}` },
      { status: 403 },
    );
  }

  let handoff: Awaited<ReturnType<ReturnType<typeof getNasProvider>['downloadFile']>>;
  try {
    handoff = await getNasProvider(node).downloadFile(node, shareId, path);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const { stream, filename, size } = handoff;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': formatContentDisposition(filename),
      'Content-Length': String(size),
    },
  });
}

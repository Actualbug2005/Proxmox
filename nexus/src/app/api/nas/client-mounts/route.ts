/**
 * GET /api/nas/client-mounts?node=<n> — CIFS / NFS mounts the node
 * is consuming as a CLIENT. Distinct from /api/nas/shares which lists
 * shares the node EXPORTS.
 *
 * Read-only — gated by Sys.Audit (same posture as the existing services
 * probe; the bash payload is provider-controlled, not client-controlled).
 *
 * Returns `{ mounts: [] }` when the provider doesn't implement the
 * optional getClientMounts hook so the UI can hide the card without a
 * 501 banner.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { requireNodeSysAudit } from '@/lib/permissions';
import { NODE_RE } from '@/lib/remote-shell';
import { getNasProvider } from '@/lib/nas/registry';

export const GET = withAuth(async (req, { session }) => {
  const node = req.nextUrl.searchParams.get('node') ?? '';
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }
  if (!(await requireNodeSysAudit(session, node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Audit required on /nodes/${node}` },
      { status: 403 },
    );
  }
  const provider = getNasProvider(node);
  if (!provider.getClientMounts) {
    return NextResponse.json({ mounts: [] });
  }
  try {
    const mounts = await provider.getClientMounts(node);
    return NextResponse.json({ mounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});

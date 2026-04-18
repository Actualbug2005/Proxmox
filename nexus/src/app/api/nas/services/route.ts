/**
 * NAS daemon status probe.
 * GET /api/nas/services?node=<name> → { services: NasService[] }
 *
 * Read-only — gated by Sys.Audit (same rationale as /api/tunnels/status:
 * the bash payload is provider-controlled, not client-controlled).
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

  try {
    const services = await getNasProvider(node).getServices(node);
    return NextResponse.json({ services });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});

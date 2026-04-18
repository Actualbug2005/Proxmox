/**
 * Per-share UNIX quota read + write.
 *
 * GET  /api/nas/quotas?node=<n>&id=<b64url>  — current users + groups report
 * POST /api/nas/quotas                       — set one (user|group, name) pair
 *
 * Reads require Sys.Audit; writes require Sys.Modify. Mirrors the auth
 * chain used by /api/nas/shares so the UI only holds one permission
 * gate in its head.
 *
 * Returns 409 with a clear message when the underlying filesystem has
 * quotas disabled — the operator can fix that one out-of-band instead
 * of misreading a 502.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { requireNodeSysAudit, requireNodeSysModify } from '@/lib/permissions';
import { NODE_RE } from '@/lib/remote-shell';
import { getNasProvider } from '@/lib/nas/registry';

const ID_RE = /^[A-Za-z0-9_-]+=*$/;

export const GET = withAuth(async (req, { session }) => {
  const node = req.nextUrl.searchParams.get('node') ?? '';
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid or missing id' }, { status: 400 });
  }
  if (!(await requireNodeSysAudit(session, node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Audit required on /nodes/${node}` },
      { status: 403 },
    );
  }

  const provider = getNasProvider(node);
  if (!provider.getQuotas) {
    return NextResponse.json(
      { error: 'Provider does not support quotas' },
      { status: 501 },
    );
  }

  try {
    const report = await provider.getQuotas(node, id);
    if (report === null) {
      return NextResponse.json(
        { error: 'Quotas are not enabled on this filesystem. Run quotaon and re-check.' },
        { status: 409 },
      );
    }
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});

interface SetQuotaBody {
  node?: string;
  id?: string;
  kind?: 'user' | 'group';
  name?: string;
  softBytes?: number;
  hardBytes?: number;
}

export const POST = withCsrf(async (req, { session }) => {
  const body = (await req.json().catch(() => ({}))) as SetQuotaBody;
  if (!body.node || !NODE_RE.test(body.node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }
  if (!body.id || !ID_RE.test(body.id)) {
    return NextResponse.json({ error: 'Invalid or missing id' }, { status: 400 });
  }
  if (body.kind !== 'user' && body.kind !== 'group') {
    return NextResponse.json({ error: 'kind must be "user" or "group"' }, { status: 400 });
  }
  if (!body.name || !/^[A-Za-z0-9._-]{1,64}$/.test(body.name)) {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  }
  const soft = Number(body.softBytes);
  const hard = Number(body.hardBytes);
  if (!Number.isFinite(soft) || soft < 0 || !Number.isFinite(hard) || hard < 0) {
    return NextResponse.json({ error: 'softBytes/hardBytes must be non-negative numbers' }, { status: 400 });
  }
  if (hard > 0 && soft > 0 && soft > hard) {
    return NextResponse.json({ error: 'softBytes must not exceed hardBytes' }, { status: 400 });
  }
  if (!(await requireNodeSysModify(session, body.node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Modify required on /nodes/${body.node}` },
      { status: 403 },
    );
  }
  const provider = getNasProvider(body.node);
  if (!provider.setQuota) {
    return NextResponse.json(
      { error: 'Provider does not support quotas' },
      { status: 501 },
    );
  }
  try {
    await provider.setQuota(
      body.node,
      body.id,
      { kind: body.kind, name: body.name },
      soft,
      hard,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});

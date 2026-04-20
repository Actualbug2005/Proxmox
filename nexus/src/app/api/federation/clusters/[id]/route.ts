/**
 * DELETE /api/federation/clusters/[id]  — remove
 * PATCH  /api/federation/clusters/[id]  — rotate credentials
 *
 * Both require Sys.Modify on / and CSRF.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import { requireRootSysModify } from '@/lib/permissions';
import { removeCluster, rotateCredentials } from '@/lib/federation/store';
import { reloadFederation } from '@/lib/federation/session';
import { redactCluster } from '@/lib/federation/serialize';

function noStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

export const DELETE = withCsrf<{ id: string }>(async (_req, { params, session }) => {
  if (!(await requireRootSysModify(session))) {
    return noStore({ error: 'Forbidden' }, 403);
  }
  const { id } = await params;
  const removed = await removeCluster(id);
  if (!removed) return noStore({ error: 'Cluster not found' }, 404);
  await reloadFederation();
  return new NextResponse(null, { status: 204 });
});

export const PATCH = withCsrf<{ id: string }>(async (req, { params, session }) => {
  if (!(await requireRootSysModify(session))) {
    return noStore({ error: 'Forbidden' }, 403);
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const updated = await rotateCredentials(id, body as Parameters<typeof rotateCredentials>[1]);
    if (!updated) return noStore({ error: 'Cluster not found' }, 404);
    await reloadFederation();
    return noStore(redactCluster(updated), 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return noStore({ error: msg }, 400);
  }
});

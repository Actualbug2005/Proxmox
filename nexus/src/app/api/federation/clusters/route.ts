/**
 * GET  /api/federation/clusters  — list (authenticated, any user)
 * POST /api/federation/clusters  — add (Sys.Modify on / + CSRF)
 *
 * Uses the project-wide withAuth / withCsrf middleware; the privilege
 * gate is a shared requireRootSysModify helper. Response serialization
 * goes through lib/federation/serialize.ts — the single boundary that
 * decides what leaves the server.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { requireRootSysModify } from '@/lib/permissions';
import { addCluster, listClusters } from '@/lib/federation/store';
import { reloadFederation } from '@/lib/federation/session';
import { redactCluster } from '@/lib/federation/serialize';

function noStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

export const GET = withAuth(async () => {
  const clusters = await listClusters();
  return noStore({ clusters: clusters.map(redactCluster) }, 200);
});

export const POST = withCsrf(async (req, { session }) => {
  if (!(await requireRootSysModify(session))) {
    return noStore({ error: 'Forbidden' }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const record = await addCluster(body as Parameters<typeof addCluster>[0]);
    await reloadFederation();
    return noStore(redactCluster(record), 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /already registered/i.test(msg) ? 409 : 400;
    return noStore({ error: msg }, status);
  }
});

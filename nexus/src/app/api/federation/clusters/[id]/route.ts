/**
 * DELETE /api/federation/clusters/[id]  — remove
 * PATCH  /api/federation/clusters/[id]  — rotate credentials
 *
 * Both require Sys.Modify on / and CSRF.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionId, getSession } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { userHasPrivilege } from '@/lib/permissions';
import { removeCluster, rotateCredentials } from '@/lib/federation/store';
import {
  getClusterProbeState,
  reloadFederation,
} from '@/lib/federation/session';
import type { RegisteredCluster } from '@/lib/federation/types';

function hardenedJson(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

function redactCluster(c: RegisteredCluster) {
  const probe = getClusterProbeState(c.id);
  return {
    id: c.id,
    name: c.name,
    endpoints: c.endpoints,
    authMode: c.authMode,
    tokenId: c.tokenId,
    savedAt: c.savedAt,
    rotatedAt: c.rotatedAt,
    probe: probe ?? null,
  };
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const sessionId = await getSessionId();
  if (!sessionId) return hardenedJson({ error: 'Unauthorized' }, 401);
  if (!validateCsrf(req, sessionId)) return hardenedJson({ error: 'Invalid CSRF token' }, 403);
  const session = await getSession();
  if (!session) return hardenedJson({ error: 'Unauthorized' }, 401);
  const allowed = await userHasPrivilege(session, '/', 'Sys.Modify');
  if (!allowed) return hardenedJson({ error: 'Forbidden' }, 403);

  const { id } = await params;
  const removed = await removeCluster(id);
  if (!removed) return hardenedJson({ error: 'Cluster not found' }, 404);
  await reloadFederation();
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const sessionId = await getSessionId();
  if (!sessionId) return hardenedJson({ error: 'Unauthorized' }, 401);
  if (!validateCsrf(req, sessionId)) return hardenedJson({ error: 'Invalid CSRF token' }, 403);
  const session = await getSession();
  if (!session) return hardenedJson({ error: 'Unauthorized' }, 401);
  const allowed = await userHasPrivilege(session, '/', 'Sys.Modify');
  if (!allowed) return hardenedJson({ error: 'Forbidden' }, 403);

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return hardenedJson({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const updated = await rotateCredentials(id, body as Parameters<typeof rotateCredentials>[1]);
    if (!updated) return hardenedJson({ error: 'Cluster not found' }, 404);
    await reloadFederation();
    return hardenedJson(redactCluster(updated), 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return hardenedJson({ error: msg }, 400);
  }
}

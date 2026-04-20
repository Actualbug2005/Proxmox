/**
 * GET  /api/federation/clusters  — list (authenticated, any user)
 * POST /api/federation/clusters  — add (Sys.Modify on / + CSRF)
 *
 * Response serializer in redactCluster() is the single point that
 * decides which fields leave the server. Anything added to
 * RegisteredCluster needs to be explicitly added here — tokenSecret
 * MUST remain elided.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionId, getSession } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { userHasPrivilege } from '@/lib/permissions';
import { addCluster, listClusters } from '@/lib/federation/store';
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
    // tokenSecret is intentionally omitted.
  };
}

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  if (!sessionId) return hardenedJson({ error: 'Unauthorized' }, 401);
  const clusters = await listClusters();
  return hardenedJson({ clusters: clusters.map(redactCluster) }, 200);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const sessionId = await getSessionId();
  if (!sessionId) return hardenedJson({ error: 'Unauthorized' }, 401);
  if (!validateCsrf(req, sessionId)) {
    return hardenedJson({ error: 'Invalid CSRF token' }, 403);
  }
  const session = await getSession();
  if (!session) return hardenedJson({ error: 'Unauthorized' }, 401);

  const allowed = await userHasPrivilege(session, '/', 'Sys.Modify');
  if (!allowed) return hardenedJson({ error: 'Forbidden' }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return hardenedJson({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const record = await addCluster(body as Parameters<typeof addCluster>[0]);
    await reloadFederation();
    return hardenedJson(redactCluster(record), 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /already registered/i.test(msg) ? 409 : 400;
    return hardenedJson({ error: msg }, status);
  }
}

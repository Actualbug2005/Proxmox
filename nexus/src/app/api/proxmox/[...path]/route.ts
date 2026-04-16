/**
 * Dynamic Proxmox API Proxy
 * Route: /api/proxmox/[...path]
 *
 * Forwards all HTTP methods to the PVE API at https://localhost:8006/api2/json/...
 * Injects PVEAuthCookie and CSRFPreventionToken from the session JWT.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId, refreshPVESessionIfStale } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { pveFetch } from '@/lib/pve-fetch';

// TLS verification for PVE's self-signed cert is scoped to pveFetch, which
// uses a dedicated undici Agent. We no longer mutate NODE_TLS_REJECT_UNAUTHORIZED
// process-wide — that leaked to every outbound fetch in the Node runtime.

const PVE_BASE = process.env.PROXMOX_HOST
  ? `https://${process.env.PROXMOX_HOST}:8006/api2/json`
  : 'https://localhost:8006/api2/json';

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const sessionId = await getSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (MUTATING.has(req.method) && !validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const rawSession = await getSession();
  if (!rawSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Proactively refresh the PVE ticket if it's past 90 min (PVE tickets
  // live ~2h; this keeps us well inside the window). On refresh failure
  // the returned session is the unchanged stale one — the downstream call
  // will 401 and trigger the normal re-login branch below.
  const session = await refreshPVESessionIfStale(sessionId, rawSession);

  const { path } = await params;
  const pathStr = path.join('/');

  // Preserve query string
  const url = new URL(req.url);
  const targetUrl = `${PVE_BASE}/${pathStr}${url.search}`;

  const headers: Record<string, string> = {
    Cookie: `PVEAuthCookie=${session.ticket}`,
    CSRFPreventionToken: session.csrfToken,
  };

  const contentType = req.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  // Narrowed to `string` — the only shape req.text() produces. Avoids the
  // global `BodyInit` vs undici's `BodyInit` type mismatch on this file.
  let body: string | undefined;
  const method = req.method;

  if (method !== 'GET' && method !== 'HEAD') {
    body = await req.text();
  }

  try {
    const pveRes = await pveFetch(targetUrl, {
      method,
      headers,
      body,
    });

    const responseText = await pveRes.text();

    const response = new NextResponse(responseText, {
      status: pveRes.status,
      headers: {
        'Content-Type': pveRes.headers.get('Content-Type') ?? 'application/json',
      },
    });

    if (pveRes.status === 401) {
      response.cookies.set('nexus_session', '', { httpOnly: true, maxAge: 0, path: '/' });
      response.cookies.set('nexus_csrf', '', { httpOnly: false, maxAge: 0, path: '/' });
    }

    return response;
  } catch (err) {
    console.error('[Proxmox Proxy Error]', err);
    return NextResponse.json(
      { error: 'Failed to reach Proxmox API', detail: String(err) },
      { status: 502 },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;

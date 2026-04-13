/**
 * Dynamic Proxmox API Proxy
 * Route: /api/proxmox/[...path]
 *
 * Forwards all HTTP methods to the PVE API at https://localhost:8006/api2/json/...
 * Injects PVEAuthCookie and CSRFPreventionToken from the session JWT.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

// Allow self-signed certs on the Proxmox host
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PVE_BASE = process.env.PROXMOX_HOST
  ? `https://${process.env.PROXMOX_HOST}:8006/api2/json`
  : 'https://localhost:8006/api2/json';

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  let body: BodyInit | undefined;
  const method = req.method;

  if (method !== 'GET' && method !== 'HEAD') {
    body = await req.text();
  }

  try {
    const pveRes = await fetch(targetUrl, {
      method,
      headers,
      body,
    });

    const responseText = await pveRes.text();

    return new NextResponse(responseText, {
      status: pveRes.status,
      headers: {
        'Content-Type': pveRes.headers.get('Content-Type') ?? 'application/json',
      },
    });
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

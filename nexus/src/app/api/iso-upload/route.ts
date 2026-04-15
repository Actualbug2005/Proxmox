/**
 * ISO / vztmpl upload passthrough.
 *
 * PVE's /nodes/{node}/storage/{storage}/upload endpoint expects multipart/form-data
 * with fields: filename, content, and the binary file. The generic /api/proxmox/[...path]
 * route reads req.text() and would corrupt binaries — so uploads get a dedicated route.
 *
 * Request (POST, multipart/form-data):
 *   node        string  — PVE node name
 *   storage     string  — target storage id
 *   content     string  — 'iso' | 'vztmpl'
 *   filename    string  — display/filename PVE will use
 *   file        File    — binary payload
 *
 * Response: JSON from PVE (typically a task UPID string wrapped in { data }).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PVE_BASE = process.env.PROXMOX_HOST
  ? `https://${process.env.PROXMOX_HOST}:8006/api2/json`
  : 'https://localhost:8006/api2/json';

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const inbound = await req.formData();
  const node = String(inbound.get('node') ?? '');
  const storage = String(inbound.get('storage') ?? '');
  const content = String(inbound.get('content') ?? '');
  const filename = String(inbound.get('filename') ?? '');
  const file = inbound.get('file');

  if (!node || !storage || !content || !filename || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing required fields: node, storage, content, filename, file' },
      { status: 400 },
    );
  }

  const outbound = new FormData();
  outbound.append('content', content);
  outbound.append('filename', filename);
  outbound.append('file', file, filename);

  const targetUrl = `${PVE_BASE}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/upload`;

  try {
    const pveRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Cookie: `PVEAuthCookie=${session.ticket}`,
        CSRFPreventionToken: session.csrfToken,
      },
      body: outbound,
    });

    const text = await pveRes.text();
    return new NextResponse(text, {
      status: pveRes.status,
      headers: {
        'Content-Type': pveRes.headers.get('Content-Type') ?? 'application/json',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to upload to PVE', detail: String(err) },
      { status: 502 },
    );
  }
}

// Next.js config: increase body size for large ISO uploads.
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

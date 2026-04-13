/**
 * termproxy ticket endpoint.
 * Returns the ticket + port so the Next.js WS relay server can connect to PVE.
 * The browser connects to /api/ws-relay?... (our plain-WS relay, see server.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { node, vmid, type } = (await req.json()) as {
    node: string;
    vmid: number;
    type: 'qemu' | 'lxc' | 'node';
  };

  const host = session.proxmoxHost;
  const base = `https://${host}:8006/api2/json`;

  const termUrl =
    type === 'node'
      ? `${base}/nodes/${node}/termproxy`
      : `${base}/nodes/${node}/${type}/${vmid}/termproxy`;

  // termproxy accepts no body params
  const res = await fetch(termUrl, {
    method: 'POST',
    headers: {
      Cookie: `PVEAuthCookie=${session.ticket}`,
      CSRFPreventionToken: session.csrfToken,
      'Content-Length': '0',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `PVE termproxy failed: ${text}` }, { status: res.status });
  }

  const data = await res.json();
  const { ticket, port, upid } = data.data;

  // The WS path PVE expects the client to connect to (via port 8006)
  const pveWsPath =
    type === 'node'
      ? `/api2/json/nodes/${node}/termproxy/ws`
      : `/api2/json/nodes/${node}/${type}/${vmid}/termproxy/ws`;

  // Return everything the relay needs — browser connects to our plain-WS relay
  return NextResponse.json({
    // Our relay endpoint (plain ws://, no cert issues)
    relayUrl: `ws://${req.headers.get('host')}/api/ws-relay`,
    // PVE connection details for the relay
    pveHost: host,
    pvePort: 8006,
    pveWsPath,
    ticket,
    port,
    upid,
    pveAuthCookie: session.ticket,
  });
}

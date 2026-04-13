/**
 * WebSocket proxy for Proxmox VNC/TERM websockets.
 * Next.js does not support native WS upgrades from route handlers,
 * so we expose a ticket-based URL builder here and let the client
 * connect directly to the PVE WS endpoint using the PVEAuthCookie.
 *
 * This route returns the WS URL + ticket for the client to use.
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

  let vncUrl: string;
  if (type === 'node') {
    vncUrl = `${base}/nodes/${node}/termproxy`;
  } else {
    vncUrl = `${base}/nodes/${node}/${type}/${vmid}/termproxy`;
  }

  const res = await fetch(vncUrl, {
    method: 'POST',
    headers: {
      Cookie: `PVEAuthCookie=${session.ticket}`,
      CSRFPreventionToken: session.csrfToken,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ websocket: '1' }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `PVE termproxy failed: ${text}` }, { status: res.status });
  }

  const data = await res.json();
  const { ticket, port, upid } = data.data;

  // Build the WS URL the client will connect to directly
  const wsProto = 'wss';
  let wsPath: string;
  if (type === 'node') {
    wsPath = `/nodes/${node}/termproxy/ws`;
  } else {
    wsPath = `/nodes/${node}/${type}/${vmid}/termproxy/ws`;
  }

  const wsUrl = `${wsProto}://${host}:8006/api2/json${wsPath}?port=${port}&vncticket=${encodeURIComponent(ticket)}`;

  return NextResponse.json({
    wsUrl,
    ticket,
    port,
    upid,
    pveAuthCookie: session.ticket,
  });
}

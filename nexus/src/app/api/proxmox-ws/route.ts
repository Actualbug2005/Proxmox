/**
 * termproxy ticket + eager WS relay session creator.
 *
 * 1. Acquires a PVE termproxy ticket
 * 2. Immediately opens a server-side WS to PVE (before the 10s ticket timeout)
 * 3. Returns a session ID the browser uses to join via ws://host/api/ws-relay?session=<id>
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
// createRelaySession is injected into globalThis by server.ts at startup.
// Both run in the same Node.js process so the reference is always live.
type CreateRelaySession = (params: {
  sessionId: string;
  pveHost: string;
  pvePort: number;
  pveWsPath: string;
  ticket: string;
  ticketPort: string;
  pveAuthCookie: string;
}) => Promise<void>;

function getCreateRelaySession(): CreateRelaySession {
  const fn = (globalThis as Record<string, unknown>).__nexusCreateRelaySession as CreateRelaySession | undefined;
  if (!fn) throw new Error('WS relay not available — is the custom server running?');
  return fn;
}
import { randomUUID } from 'crypto';

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

  const pveWsPath =
    type === 'node'
      ? `/api2/json/nodes/${node}/vncwebsocket`
      : `/api2/json/nodes/${node}/${type}/${vmid}/vncwebsocket`;

  const sessionId = randomUUID();

  // Open the PVE WebSocket NOW (server-side) before the ticket expires.
  // The browser will join this already-open connection via the relay.
  try {
    const createRelaySession = getCreateRelaySession();
    await createRelaySession({
      sessionId,
      pveHost: host,
      pvePort: 8006,
      pveWsPath,
      ticket,
      ticketPort: String(port),
      pveAuthCookie: session.ticket,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to open PVE terminal connection: ${String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    sessionId,
    upid,
  });
}

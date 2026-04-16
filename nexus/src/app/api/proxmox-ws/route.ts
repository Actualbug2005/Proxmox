/**
 * termproxy ticket + eager WS relay session creator.
 *
 * 1. Acquires a PVE termproxy ticket
 * 2. Immediately opens a server-side WS to PVE (before the 10s ticket timeout)
 * 3. Returns a session ID the browser uses to join via ws://host/api/ws-relay?session=<id>
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { pveFetch } from '@/lib/pve-fetch';
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
  username: string;
}) => Promise<void>;

function getCreateRelaySession(): CreateRelaySession {
  const fn = (globalThis as Record<string, unknown>).__nexusCreateRelaySession as CreateRelaySession | undefined;
  if (!fn) throw new Error('WS relay not available — is the custom server running?');
  return fn;
}
import { randomUUID } from 'crypto';

// TLS verification for PVE's self-signed cert is scoped to pveFetch.
// Global NODE_TLS_REJECT_UNAUTHORIZED mutation removed per security audit.

const NODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,62}$/;
const TYPE_SET = new Set(['qemu', 'lxc', 'node'] as const);
type ValidType = 'qemu' | 'lxc' | 'node';

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { node, vmid, type } = (await req.json()) as {
    node: unknown;
    vmid: unknown;
    type: unknown;
  };

  if (typeof node !== 'string' || !NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid node name' }, { status: 400 });
  }
  if (typeof type !== 'string' || !TYPE_SET.has(type as ValidType)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }
  const validType = type as ValidType;
  let vmidNum: number | null = null;
  if (validType !== 'node') {
    if (typeof vmid !== 'number' || !Number.isInteger(vmid) || vmid < 0 || vmid > 999_999_999) {
      return NextResponse.json({ error: 'Invalid vmid' }, { status: 400 });
    }
    vmidNum = vmid;
  }

  const host = session.proxmoxHost;
  const base = `https://${host}:8006/api2/json`;

  const termUrl =
    validType === 'node'
      ? `${base}/nodes/${node}/termproxy`
      : `${base}/nodes/${node}/${validType}/${vmidNum}/termproxy`;

  const res = await pveFetch(termUrl, {
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

  const data = (await res.json()) as {
    data: { ticket: string; port: number; upid: string };
  };
  const { ticket, port, upid } = data.data;

  const pveWsPath =
    validType === 'node'
      ? `/api2/json/nodes/${node}/vncwebsocket`
      : `/api2/json/nodes/${node}/${validType}/${vmidNum}/vncwebsocket`;

  const relaySessionId = randomUUID();

  // Open the PVE WebSocket NOW (server-side) before the ticket expires.
  // The browser will join this already-open connection via the relay.
  try {
    const createRelaySession = getCreateRelaySession();
    await createRelaySession({
      sessionId: relaySessionId,
      pveHost: host,
      pvePort: 8006,
      pveWsPath,
      ticket,
      ticketPort: String(port),
      pveAuthCookie: session.ticket,
      username: session.username,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to open PVE terminal connection: ${String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    sessionId: relaySessionId,
    upid,
  });
}

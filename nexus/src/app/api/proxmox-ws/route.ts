/**
 * termproxy | vncproxy ticket + eager WS relay session creator.
 *
 * 1. Acquires a PVE console ticket (termproxy for shell, vncproxy for VNC).
 * 2. Immediately opens a server-side WS to PVE (before the 10 s ticket timeout).
 * 3. Returns a session ID the browser uses to join via
 *    wss://host/api/ws-relay?session=<id> — TLS is terminated at the edge
 *    (Caddy / Cloudflare Tunnel) so the browser always uses secure
 *    WebSockets in production. Local `next dev` over plain HTTP is the
 *    only case where the browser falls back to unencrypted transport.
 *
 * Dispatch is driven by `body.mode`:
 *   - `"shell"` (default) → termproxy; xterm front-end.
 *   - `"vnc"`             → vncproxy; noVNC front-end.
 * The relay in server.ts skips the termproxy auth preamble in VNC mode so
 * the RFB handshake reaches noVNC unmodified. The PVE endpoint path also
 * swaps (vncwebsocket already; termproxy → vncproxy for the ticket call).
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
  mode?: 'shell' | 'vnc';
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
type WsTargetType = 'qemu' | 'lxc' | 'node';
const MODE_SET = new Set(['shell', 'vnc'] as const);
type ConsoleMode = 'shell' | 'vnc';

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { node, vmid, type, mode: rawMode } = (await req.json()) as {
    node: unknown;
    vmid: unknown;
    type: unknown;
    mode?: unknown;
  };

  if (typeof node !== 'string' || !NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid node name' }, { status: 400 });
  }
  if (typeof type !== 'string' || !TYPE_SET.has(type as WsTargetType)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }
  const validType = type as WsTargetType;
  // Default is shell so existing xterm callers that never set `mode` keep
  // working unchanged.
  const mode: ConsoleMode =
    typeof rawMode === 'string' && MODE_SET.has(rawMode as ConsoleMode)
      ? (rawMode as ConsoleMode)
      : 'shell';
  // vncproxy doesn't exist at the node scope (there's no "node console") —
  // refuse the combination up front rather than letting PVE 404.
  if (mode === 'vnc' && validType === 'node') {
    return NextResponse.json({ error: 'VNC console is only valid for qemu/lxc' }, { status: 400 });
  }
  let vmidNum: number | null = null;
  if (validType !== 'node') {
    if (typeof vmid !== 'number' || !Number.isInteger(vmid) || vmid < 0 || vmid > 999_999_999) {
      return NextResponse.json({ error: 'Invalid vmid' }, { status: 400 });
    }
    vmidNum = vmid;
  }

  const host = session.proxmoxHost;
  const base = `https://${host}:8006/api2/json`;

  const proxyEndpoint = mode === 'vnc' ? 'vncproxy' : 'termproxy';
  const proxyUrl =
    validType === 'node'
      ? `${base}/nodes/${node}/${proxyEndpoint}`
      : `${base}/nodes/${node}/${validType}/${vmidNum}/${proxyEndpoint}`;

  // vncproxy requires websocket=1 to return a ticket usable with the
  // vncwebsocket bridge. termproxy does NOT accept that field — PVE 9
  // validates bodies against a strict schema (additionalProperties:false)
  // and rejects the request with "property is not defined in schema".
  // Send the flag only on the VNC branch; termproxy POSTs with no body.
  const res = await pveFetch(proxyUrl, {
    method: 'POST',
    headers: {
      Cookie: `PVEAuthCookie=${session.ticket}`,
      CSRFPreventionToken: session.csrfToken,
      ...(mode === 'vnc' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(mode === 'vnc' ? { body: 'websocket=1' } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `PVE ${proxyEndpoint} failed: ${text}` },
      { status: res.status },
    );
  }

  const data = (await res.json()) as {
    data: { ticket: string; port: number; upid?: string; user?: string };
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
      mode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to open PVE console connection: ${String(err)}` },
      { status: 502 },
    );
  }

  // For graphical (VNC) consoles, the inner RFB stream still goes through
  // QEMU's VNC Auth — pveproxy validates the vncticket at the WebSocket
  // layer, but the inner stream challenges with the same ticket (truncated
  // to 8 bytes) as the VNC password. Without this, noVNC stalls waiting
  // for credentials it never receives. We expose the ticket only in vnc
  // mode and only to a session that already passed CSRF + auth checks
  // above; the powerful PVEAuthCookie remains server-side. The vncticket
  // itself is single-VM-scoped and TTL ~30 s — narrower blast radius than
  // any other credential the browser already holds.
  return NextResponse.json({
    sessionId: relaySessionId,
    upid: upid ?? null,
    mode,
    ...(mode === 'vnc' ? { vncTicket: ticket } : {}),
  });
}

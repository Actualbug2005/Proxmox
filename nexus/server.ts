/**
 * Custom Next.js server with WebSocket relay for Proxmox termproxy.
 *
 * Flow:
 * 1. POST /api/proxmox-ws → acquires PVE ticket + opens server-side WS to PVE immediately
 * 2. Browser opens ws://host/api/ws-relay?session=<id> → bridged to already-open PVE connection
 */
import { createServer } from 'node:http';
import { parse } from 'node:url';
import { randomUUID } from 'node:crypto';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const port = parseInt(process.env.PORT ?? '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// ── Relay session store (shared via module singleton) ─────────────────────────
interface RelaySession {
  pveWs: WebSocket;
  clientWs: WebSocket | null;
  buffer: (Buffer | string)[];
  createdAt: number;
}

export const relaySessions = new Map<string, RelaySession>();

export function createRelaySession(params: {
  sessionId: string;
  pveHost: string;
  pvePort: number;
  pveWsPath: string;
  ticket: string;
  ticketPort: string;
  pveAuthCookie: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const { sessionId, ticket, ticketPort, pveAuthCookie } = params;

    // Connect through pveproxy's vncwebsocket endpoint (not termproxy/ws which returns 501,
    // and not ws://127.0.0.1:<port> directly which is raw TCP, not WebSocket).
    // pveproxy validates the vncticket query param then bridges to the local termproxy TCP port.
    const pveWsUrl = `wss://${pveHost}:${pvePort}${pveWsPath}?port=${ticketPort}&vncticket=${encodeURIComponent(ticket)}`;

    const pveWs = new WebSocket(pveWsUrl, ['binary'], {
      headers: { Cookie: `PVEAuthCookie=${pveAuthCookie}` },
      rejectUnauthorized: false,
    } as Parameters<typeof WebSocket>[2]);

    const session: RelaySession = {
      pveWs,
      clientWs: null,
      buffer: [],
      createdAt: Date.now(),
    };

    pveWs.on('open', () => {
      // No auth handshake needed — pveproxy validates via vncticket URL param
      relaySessions.set(sessionId, session);
      resolve();
    });

    pveWs.on('message', (data) => {
      if (!session.clientWs) {
        session.buffer.push(data as Buffer | string);
      }
    });

    pveWs.on('error', reject);

    setTimeout(() => {
      if (pveWs.readyState !== WebSocket.OPEN) {
        pveWs.terminate();
        reject(new Error('PVE WebSocket timed out'));
      }
    }, 8_000);
  });
}

// Expose createRelaySession to Next.js route handlers via globalThis
(globalThis as Record<string, unknown>).__nexusCreateRelaySession = createRelaySession;

// Clean up stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of relaySessions) {
    if (now - s.createdAt > 120_000) {
      s.pveWs.terminate();
      relaySessions.delete(id);
    }
  }
}, 30_000);

// ── Start server ──────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? '', true);
    if (pathname !== '/api/ws-relay') { socket.destroy(); return; }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const sessionId = query.session as string;
      if (!sessionId) { clientWs.close(4000, 'Missing session'); return; }

      const session = relaySessions.get(sessionId);
      if (!session) { clientWs.close(4004, 'Session expired'); return; }

      session.clientWs = clientWs;
      const { pveWs, buffer } = session;

      // Flush buffered data
      for (const chunk of buffer) {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(chunk);
      }
      session.buffer = [];

      pveWs.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
      });
      clientWs.on('message', (data) => {
        if (pveWs.readyState === WebSocket.OPEN) pveWs.send(data);
      });
      clientWs.on('close', () => { pveWs.close(); relaySessions.delete(sessionId); });
      clientWs.on('error', () => { pveWs.close(); relaySessions.delete(sessionId); });
      pveWs.on('close', () => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, 'PVE closed');
        relaySessions.delete(sessionId);
      });
    });
  });

  httpServer.listen(port, () => {
    console.log(`▲ Next.js + WS relay ready on http://localhost:${port}`);
  });
});

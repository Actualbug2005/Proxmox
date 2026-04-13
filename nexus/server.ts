/**
 * Custom Next.js server with WebSocket relay for Proxmox termproxy.
 *
 * Flow:
 * 1. Browser POSTs to /api/proxmox-ws — server acquires PVE termproxy ticket
 *    AND immediately opens a server-side WS to PVE (before the ticket expires).
 *    Returns a relay session ID.
 * 2. Browser opens ws://nexus:3000/api/ws-relay?session=<id>
 * 3. Server bridges the already-open PVE connection to the browser.
 */
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { relaySessions } from './src/lib/relay-sessions';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const port = parseInt(process.env.PORT ?? '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Clean up stale sessions older than 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of relaySessions) {
    if (now - session.createdAt > 120_000) {
      session.pveWs.terminate();
      relaySessions.delete(id);
    }
  }
}, 30_000);

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? '', true);

    if (pathname !== '/api/ws-relay') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const sessionId = query.session as string;

      if (!sessionId) {
        clientWs.close(4000, 'Missing session ID');
        return;
      }

      const session = relaySessions.get(sessionId);
      if (!session) {
        clientWs.close(4004, 'Session not found or expired');
        return;
      }

      session.clientWs = clientWs;
      const { pveWs, buffer } = session;

      // Flush buffered data that arrived before browser connected
      for (const chunk of buffer) {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(chunk);
        }
      }
      session.buffer = [];

      // Relay PVE → browser
      pveWs.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      // Relay browser → PVE
      clientWs.on('message', (data) => {
        if (pveWs.readyState === WebSocket.OPEN) {
          pveWs.send(data);
        }
      });

      clientWs.on('close', () => {
        pveWs.close();
        relaySessions.delete(sessionId);
      });

      clientWs.on('error', () => {
        pveWs.close();
        relaySessions.delete(sessionId);
      });

      pveWs.on('close', () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1000, 'PVE connection closed');
        }
        relaySessions.delete(sessionId);
      });
    });
  });

  httpServer.listen(port, () => {
    console.log(`▲ Next.js + WS relay ready on http://localhost:${port}`);
  });
});

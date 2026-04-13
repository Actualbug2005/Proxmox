/**
 * Custom Next.js server with WebSocket relay for Proxmox termproxy.
 *
 * The browser connects to ws://nexus-host:3000/api/ws-relay?...
 * This server proxies that connection to wss://pve-host:8006/... (self-signed cert OK server-side).
 */
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import * as tls from 'tls';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const port = parseInt(process.env.PORT ?? '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

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
      const {
        pveHost,
        pvePort,
        pveWsPath,
        ticket,
        port: ticketPort,
        pveAuthCookie,
      } = query as Record<string, string>;

      if (!pveHost || !pveWsPath || !ticket) {
        clientWs.close(4000, 'Missing required params');
        return;
      }

      // Connect to PVE over TLS (self-signed cert allowed via NODE_TLS_REJECT_UNAUTHORIZED=0)
      const pveWsUrl = `wss://${pveHost}:${pvePort ?? 8006}${pveWsPath}?port=${ticketPort}&vncticket=${encodeURIComponent(ticket)}`;

      const pveWs = new WebSocket(pveWsUrl, ['binary'], {
        headers: {
          Cookie: `PVEAuthCookie=${pveAuthCookie}`,
        },
        rejectUnauthorized: false,
      });

      pveWs.on('open', () => {
        // PVE termproxy expects username:ticket as first message
        pveWs.send(`${pveAuthCookie}:${ticket}\n`);
      });

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

      pveWs.on('close', (code, reason) => {
        clientWs.close(code, reason);
      });

      pveWs.on('error', (err) => {
        console.error('[ws-relay] PVE WS error:', err.message);
        clientWs.close(4001, 'PVE connection error');
      });

      clientWs.on('close', () => {
        pveWs.close();
      });

      clientWs.on('error', (err) => {
        console.error('[ws-relay] Client WS error:', err.message);
        pveWs.close();
      });
    });
  });

  httpServer.listen(port, () => {
    console.log(`▲ Next.js ready on http://localhost:${port}`);
  });
});

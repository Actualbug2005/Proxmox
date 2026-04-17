/**
 * Custom Next.js server with WebSocket relay for Proxmox termproxy.
 *
 * Flow:
 * 1. POST /api/proxmox-ws → acquires PVE ticket + opens server-side WS to PVE immediately
 * 2. Browser opens a WebSocket to /api/ws-relay?session=<id> → bridged to the
 *    already-open PVE connection. The scheme (ws / wss) is determined by the
 *    ingress in front of Nexus — loopback is plain, edge-facing is TLS.
 */
import { createServer } from 'node:http';
import next from 'next';
// Node's --experimental-strip-types needs explicit extensions on relative
// imports (no webpack/Next.js resolver in the custom-server entry point).
import { startScheduler } from './src/lib/scheduler.ts';
import { runScriptJob } from './src/lib/run-script-job.ts';
// False positive — this imports the `ws` library; the actual connection
// we open below uses wss:// (see pveWsUrl). The rule matches on the
// literal string 'ws' in the module specifier.
// nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientOptions } from 'ws';

// WHATWG URL requires a base when parsing a path-only request.url. The base
// itself is never used — only the path + query get read — so this constant
// is safe to hard-code.
const URL_BASE = 'http://localhost';

// TLS verification for PVE's self-signed cert is scoped inside the process:
//   - HTTP calls go through pveFetch (undici Agent with rejectUnauthorized: false)
//   - WS call below passes rejectUnauthorized: false via ClientOptions
// No process-global NODE_TLS_REJECT_UNAUTHORIZED — it leaked to all
// outbound traffic in the Node runtime (critical finding C1).

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
  username: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const { sessionId, pveHost, pvePort, pveWsPath, ticket, ticketPort, pveAuthCookie, username } = params;

    // Connect through pveproxy's vncwebsocket endpoint (not termproxy which
    // returns 501, and not raw TCP which is not a WebSocket at all).
    // pveproxy validates the vncticket query param then bridges to the local
    // termproxy TCP port.
    const pveWsUrl = `wss://${pveHost}:${pvePort}${pveWsPath}?port=${ticketPort}&vncticket=${encodeURIComponent(ticket)}`;

    // Scoped TLS bypass for PVE's self-signed cert. pveHost is loaded from
    // the server-side session (which got it from process.env.PROXMOX_HOST at
    // login), not from the client — same trust scope as pve-fetch.ts's
    // undici Agent (audit finding C1). The `ws` package has no
    // dispatcher/agent equivalent, so rejectUnauthorized:false is the only
    // API for this single connection.
    // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
    const pveWs = new WebSocket(pveWsUrl, ['binary'], {
      headers: { Cookie: `PVEAuthCookie=${pveAuthCookie}` },
      rejectUnauthorized: false,
    } as ClientOptions);

    const session: RelaySession = {
      pveWs,
      clientWs: null,
      buffer: [],
      createdAt: Date.now(),
    };

    pveWs.on('open', () => {
      // pveproxy is a transparent WS<->TCP bridge. termproxy (Rust) expects the
      // first line to be "user:ticket\n" (see proxmox-termproxy/src/main.rs
      // read_ticket()). Without this exact format, termproxy times out.
      pveWs.send(`${username}:${ticket}\n`);
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

// Clean up ABANDONED pre-connection sessions — ones where the browser never
// joined the relay within 30s. Once a client is attached, lifecycle is handled
// by the clientWs close/error handlers — never terminate an active session here.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of relaySessions) {
    if (s.clientWs === null && now - s.createdAt > 30_000) {
      s.pveWs.terminate();
      relaySessions.delete(id);
    }
  }
}, 15_000);

// ── Start server ──────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    // Next.js does its own URL parsing internally when parsedUrl is omitted,
    // so we don't need to duplicate it here. Dropping the legacy url.parse()
    // call also kills DEP0169 at runtime.
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', URL_BASE);
    if (url.pathname !== '/api/ws-relay') { socket.destroy(); return; }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const sessionId = url.searchParams.get('session');
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

  // Scheduler tick — fires due schedules through the shared runner. ACL
  // was enforced at schedule-create time; the runner validates scriptUrl
  // and node name again as defense in depth.
  const DEFAULT_SCHED_TIMEOUT_MS = 15 * 60 * 1000;
  startScheduler(async (job) => {
    const result = await runScriptJob({
      user: job.owner,
      node: job.node,
      scriptUrl: job.scriptUrl,
      scriptName: job.scriptName,
      slug: job.slug,
      method: job.method,
      env: job.env,
      timeoutMs: job.timeoutMs ?? DEFAULT_SCHED_TIMEOUT_MS,
    });
    return { jobId: result.jobId };
  });
});

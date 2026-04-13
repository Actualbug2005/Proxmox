/**
 * Shared relay session store.
 * Lives in a module so both server.ts and the API route handler share the same Map
 * via Node's module cache (same process).
 */
import { WebSocket } from 'ws';

export interface RelaySession {
  pveWs: WebSocket;
  clientWs: WebSocket | null;
  buffer: (Buffer | string)[];
  createdAt: number;
}

// Single shared Map — works because Next.js runs API routes in the same Node process
// as the custom server.ts
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
    const { sessionId, pveHost, pvePort, pveWsPath, ticket, ticketPort, pveAuthCookie } = params;

    const pveWsUrl = `wss://${pveHost}:${pvePort}${pveWsPath}?port=${ticketPort}&vncticket=${encodeURIComponent(ticket)}`;

    const pveWs = new WebSocket(pveWsUrl, ['binary'], {
      headers: { Cookie: `PVEAuthCookie=${pveAuthCookie}` },
      rejectUnauthorized: false,
    });

    const session: RelaySession = {
      pveWs,
      clientWs: null,
      buffer: [],
      createdAt: Date.now(),
    };

    pveWs.on('open', () => {
      // PVE termproxy expects "user:ticket\n" as first message
      pveWs.send(`${pveAuthCookie}:${ticket}\n`);
      relaySessions.set(sessionId, session);
      resolve();
    });

    // Buffer data that arrives before the browser connects
    pveWs.on('message', (data) => {
      if (!session.clientWs) {
        session.buffer.push(data as Buffer | string);
      }
    });

    pveWs.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      if (pveWs.readyState !== WebSocket.OPEN) {
        pveWs.terminate();
        reject(new Error('PVE WebSocket timed out'));
      }
    }, 8_000);
  });
}

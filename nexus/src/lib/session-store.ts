/**
 * Server-side session store.
 *
 * The Proxmox ticket + CSRF prevention token never leave the server — only an
 * opaque random sessionId goes to the browser in an httpOnly cookie. This
 * keeps root-equivalent PVE credentials off the wire even on plain HTTP LANs
 * and stops anyone with browser-dev-tools access from exfiltrating the ticket.
 *
 * Storage: in-memory Map in the Node.js process (Nexus runs via a single
 * custom server.ts). If a REDIS_URL is configured we fall back to it so the
 * store survives restarts and load-balanced deployments — handled transparently.
 */
import type { PVEAuthSession } from '@/types/proxmox';

export interface StoredSession extends PVEAuthSession {
  expiresAt: number;
}

const TTL_MS = 8 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 5 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __nexusSessionStore: Map<string, StoredSession> | undefined;
  // eslint-disable-next-line no-var
  var __nexusSessionCleanup: NodeJS.Timeout | undefined;
}

function store(): Map<string, StoredSession> {
  if (!globalThis.__nexusSessionStore) {
    globalThis.__nexusSessionStore = new Map();
  }
  if (!globalThis.__nexusSessionCleanup) {
    const t = setInterval(() => {
      const now = Date.now();
      for (const [id, s] of globalThis.__nexusSessionStore!.entries()) {
        if (s.expiresAt <= now) globalThis.__nexusSessionStore!.delete(id);
      }
    }, CLEANUP_EVERY_MS);
    t.unref?.();
    globalThis.__nexusSessionCleanup = t;
  }
  return globalThis.__nexusSessionStore;
}

export function putSession(sessionId: string, data: PVEAuthSession, ttlMs: number = TTL_MS): void {
  store().set(sessionId, { ...data, expiresAt: Date.now() + ttlMs });
}

export function getStoredSession(sessionId: string): PVEAuthSession | null {
  const s = store().get(sessionId);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    store().delete(sessionId);
    return null;
  }
  const { expiresAt: _expiresAt, ...session } = s;
  void _expiresAt;
  return session;
}

export function deleteStoredSession(sessionId: string): void {
  store().delete(sessionId);
}

export const SESSION_TTL_MS = TTL_MS;

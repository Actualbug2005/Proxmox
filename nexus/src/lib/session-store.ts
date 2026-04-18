/**
 * Server-side session store — hybrid backend.
 *
 * The Proxmox ticket + CSRF prevention token never leave the server. The
 * browser holds an opaque random sessionId; lookups happen here.
 *
 * Backend selection at module load:
 *   • REDIS_URL set      → ioredis client, JSON values, native EX TTL.
 *                          Survives process restarts and works across
 *                          multiple Nexus replicas behind a load balancer.
 *   • REDIS_URL unset    → in-memory Map with a 5-minute interval GC.
 *                          Suitable for single-node / dev installs.
 *
 * The exported API is `Promise`-typed regardless of backend so callers don't
 * need to branch — the memory backend just resolves synchronously.
 */
import Redis from 'ioredis';
import type { PVEAuthSession } from '@/types/proxmox';

const TTL_MS = 8 * 60 * 60 * 1000;
const TTL_SECONDS = Math.floor(TTL_MS / 1000);
const REDIS_KEY_PREFIX = 'nexus:session:';
const GC_INTERVAL_MS = 5 * 60 * 1000;

export const SESSION_TTL_MS = TTL_MS;

export type SessionBackendKind = 'redis' | 'memory';

interface SessionBackend {
  readonly kind: SessionBackendKind;
  put(sessionId: string, data: PVEAuthSession, ttlMs: number): Promise<void>;
  get(sessionId: string): Promise<PVEAuthSession | null>;
  delete(sessionId: string): Promise<void>;
}

// ─── Redis backend ──────────────────────────────────────────────────────────

/**
 * Number of consecutive Redis `error` events before we give up on Redis and
 * flip the singleton to the in-memory backend (H9). Three events over the
 * ioredis retry window is a firm enough signal to say "Redis is not reachable
 * right now"; a healthier transient blip clears via the 'ready' listener.
 */
const REDIS_FAILOVER_THRESHOLD = 3;

function buildRedisBackend(url: string): SessionBackend {
  const client = new Redis(url, {
    // Don't queue indefinitely on outage — fail fast so the route can 503.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  let consecutiveErrors = 0;
  let failedOver = false;

  client.on('error', (err: Error) => {
    consecutiveErrors += 1;
    // Connection errors are noisy on outage. Log but don't crash — the
    // session lookup will reject and the route will surface a 401/500.
    console.error('[session-store:redis] error:', err.message);
    if (!failedOver && consecutiveErrors >= REDIS_FAILOVER_THRESHOLD) {
      failedOver = true;
      console.error(
        '[nexus event=session_store_fallback] redis unreachable after %d errors; flipping to memory backend (existing Redis sessions are unreachable regardless)',
        REDIS_FAILOVER_THRESHOLD,
      );
      // Swap the module-level singleton. The next backend() call picks up
      // the memory backend; in-flight Redis calls still reject once with
      // the connection error (caller 401s / 500s, browser retries login).
      globalThis.__nexusSessionBackend = buildMemoryBackend();
      // Stop trying to reconnect so we don't leak sockets/timers.
      client.disconnect();
    }
  });

  // A clean reconnect resets the failure count — allows short outages to
  // recover without permanent fallback. Once `failedOver` is true the flag
  // stays — a Redis that came back after we abandoned it is a new story
  // best solved with an operator-initiated Nexus restart.
  client.on('ready', () => {
    if (!failedOver) consecutiveErrors = 0;
  });

  return {
    kind: 'redis',
    async put(sessionId, data, ttlMs) {
      const seconds = Math.max(1, Math.floor(ttlMs / 1000));
      await client.set(REDIS_KEY_PREFIX + sessionId, JSON.stringify(data), 'EX', seconds);
    },
    async get(sessionId) {
      const raw = await client.get(REDIS_KEY_PREFIX + sessionId);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as PVEAuthSession;
      } catch {
        // Corrupted JSON → drop the entry so the next login overwrites it.
        await client.del(REDIS_KEY_PREFIX + sessionId);
        return null;
      }
    },
    async delete(sessionId) {
      await client.del(REDIS_KEY_PREFIX + sessionId);
    },
  };
}

// ─── In-memory backend (fallback) ───────────────────────────────────────────

interface MemoryEntry {
  data: PVEAuthSession;
  expiresAt: number;
}

declare global {
   
  var __nexusSessionMap: Map<string, MemoryEntry> | undefined;
   
  var __nexusSessionGc: NodeJS.Timeout | undefined;
}

function buildMemoryBackend(): SessionBackend {
  // Survive Next.js dev HMR by stashing the Map on globalThis.
  if (!globalThis.__nexusSessionMap) {
    globalThis.__nexusSessionMap = new Map();
  }
  if (!globalThis.__nexusSessionGc) {
    const t = setInterval(() => {
      const now = Date.now();
      const map = globalThis.__nexusSessionMap!;
      for (const [id, entry] of map.entries()) {
        if (entry.expiresAt <= now) map.delete(id);
      }
    }, GC_INTERVAL_MS);
    t.unref?.();
    globalThis.__nexusSessionGc = t;
  }
  const map = globalThis.__nexusSessionMap;

  return {
    kind: 'memory',
    async put(sessionId, data, ttlMs) {
      map.set(sessionId, { data, expiresAt: Date.now() + ttlMs });
    },
    async get(sessionId) {
      const entry = map.get(sessionId);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        map.delete(sessionId);
        return null;
      }
      return entry.data;
    },
    async delete(sessionId) {
      map.delete(sessionId);
    },
  };
}

// ─── Singleton wiring ───────────────────────────────────────────────────────

declare global {
   
  var __nexusSessionBackend: SessionBackend | undefined;
}

function backend(): SessionBackend {
  if (!globalThis.__nexusSessionBackend) {
    const url = process.env.REDIS_URL;
    globalThis.__nexusSessionBackend = url ? buildRedisBackend(url) : buildMemoryBackend();
    if (process.env.NODE_ENV !== 'test') {
      console.info(
        `[session-store] backend=${globalThis.__nexusSessionBackend.kind}` +
          (url ? ' (REDIS_URL set)' : ' (in-memory fallback; set REDIS_URL for persistence)'),
      );
    }
  }
  return globalThis.__nexusSessionBackend;
}

export function getSessionBackendKind(): SessionBackendKind {
  return backend().kind;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function putSession(
  sessionId: string,
  data: PVEAuthSession,
  ttlMs: number = TTL_MS,
): Promise<void> {
  await backend().put(sessionId, data, ttlMs);
}

export async function getStoredSession(sessionId: string): Promise<PVEAuthSession | null> {
  return backend().get(sessionId);
}

export async function deleteStoredSession(sessionId: string): Promise<void> {
  await backend().delete(sessionId);
}

// Re-exported for tests / observability.
export { TTL_SECONDS as SESSION_TTL_SECONDS };

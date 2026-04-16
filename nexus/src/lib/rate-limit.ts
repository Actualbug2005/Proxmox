/**
 * Rate limiter + concurrency semaphore for per-session request gating.
 *
 * Two independent primitives share this module:
 *
 *   1. takeToken(userId, endpoint, limit, windowMs) → fixed-window counter.
 *      Grants a token if under-limit in the current window; returns a
 *      retry-after hint otherwise. Used for "X calls per Y seconds" rules.
 *
 *   2. acquireSlot(userId, endpoint, max) → concurrency semaphore.
 *      Grants a slot if currently under `max` in-flight requests. Caller
 *      MUST invoke the returned release() in a try/finally; otherwise the
 *      slot leaks. Used for "no more than N parallel exec/run" rules.
 *
 * Backends:
 *   • REDIS_URL set      → ioredis INCR/EXPIRE for the token bucket,
 *                          INCR/DECR for concurrency. Atomic, survives
 *                          multi-replica deployments.
 *   • REDIS_URL unset    → in-memory Map with GC. Single-process only;
 *                          adequate for homelab single-node Nexus.
 *
 * Keys are prefixed `nexus:rl:` to avoid colliding with the session store.
 */
import Redis from 'ioredis';

const REDIS_PREFIX = 'nexus:rl:';
const GC_INTERVAL_MS = 60_000;

// ─── Shared types ───────────────────────────────────────────────────────────

export interface TakeTokenResult {
  allowed: boolean;
  /** Present when `allowed === false`. Milliseconds until the next window opens. */
  retryAfterMs?: number;
  /** Remaining tokens in the current window after this take. */
  remaining: number;
}

export interface Slot {
  release(): Promise<void>;
}

interface RateLimitBackend {
  readonly kind: 'redis' | 'memory';
  take(key: string, limit: number, windowMs: number): Promise<TakeTokenResult>;
  /** Returns null if `max` would be exceeded; otherwise a release handle. */
  acquire(key: string, max: number, ttlMs: number): Promise<Slot | null>;
}

// ─── Redis backend ─────────────────────────────────────────────────────────

function buildRedisBackend(url: string): RateLimitBackend {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err: Error) => {
    console.error('[rate-limit:redis] error:', err.message);
  });

  return {
    kind: 'redis',
    async take(key, limit, windowMs) {
      // Atomic fixed-window counter. INCR always succeeds; we PEXPIRE only
      // on the first hit of a new window (when INCR returns 1).
      const k = REDIS_PREFIX + 'tok:' + key;
      const count = await client.incr(k);
      if (count === 1) {
        await client.pexpire(k, windowMs);
      }
      if (count > limit) {
        const pttl = await client.pttl(k);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: pttl > 0 ? pttl : windowMs,
        };
      }
      return { allowed: true, remaining: limit - count };
    },
    async acquire(key, max, ttlMs) {
      const k = REDIS_PREFIX + 'cc:' + key;
      const count = await client.incr(k);
      // Set TTL on first acquire to prevent leaked slots from orphaned
      // handlers (e.g. process crash before release). Subsequent acquires
      // don't refresh the TTL — it represents "worst case execution window".
      if (count === 1) {
        await client.pexpire(k, ttlMs);
      }
      if (count > max) {
        // Over cap — undo the increment and refuse.
        await client.decr(k);
        return null;
      }
      return {
        async release() {
          // Guard against releasing twice (e.g. if caller forgets to
          // short-circuit). DECR floors at 0 logically; we delete the key
          // when we hit 0 to keep Redis tidy.
          const after = await client.decr(k);
          if (after <= 0) {
            await client.del(k);
          }
        },
      };
    },
  };
}

// ─── In-memory backend ─────────────────────────────────────────────────────

interface TokenEntry {
  count: number;
  expiresAt: number;
}

interface SlotEntry {
  count: number;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __nexusRateLimitTokens: Map<string, TokenEntry> | undefined;
  // eslint-disable-next-line no-var
  var __nexusRateLimitSlots: Map<string, SlotEntry> | undefined;
  // eslint-disable-next-line no-var
  var __nexusRateLimitGc: NodeJS.Timeout | undefined;
}

function buildMemoryBackend(): RateLimitBackend {
  if (!globalThis.__nexusRateLimitTokens) {
    globalThis.__nexusRateLimitTokens = new Map();
  }
  if (!globalThis.__nexusRateLimitSlots) {
    globalThis.__nexusRateLimitSlots = new Map();
  }
  if (!globalThis.__nexusRateLimitGc) {
    const t = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of globalThis.__nexusRateLimitTokens!.entries()) {
        if (v.expiresAt <= now) globalThis.__nexusRateLimitTokens!.delete(k);
      }
      for (const [k, v] of globalThis.__nexusRateLimitSlots!.entries()) {
        if (v.expiresAt <= now) globalThis.__nexusRateLimitSlots!.delete(k);
      }
    }, GC_INTERVAL_MS);
    t.unref?.();
    globalThis.__nexusRateLimitGc = t;
  }
  const tokens = globalThis.__nexusRateLimitTokens;
  const slots = globalThis.__nexusRateLimitSlots;

  return {
    kind: 'memory',
    async take(key, limit, windowMs) {
      const now = Date.now();
      const existing = tokens.get(key);
      if (!existing || existing.expiresAt <= now) {
        tokens.set(key, { count: 1, expiresAt: now + windowMs });
        return { allowed: true, remaining: limit - 1 };
      }
      if (existing.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: existing.expiresAt - now,
        };
      }
      existing.count += 1;
      return { allowed: true, remaining: limit - existing.count };
    },
    async acquire(key, max, ttlMs) {
      const now = Date.now();
      const existing = slots.get(key);
      if (!existing || existing.expiresAt <= now) {
        slots.set(key, { count: 1, expiresAt: now + ttlMs });
      } else if (existing.count >= max) {
        return null;
      } else {
        existing.count += 1;
      }
      return {
        async release() {
          const cur = slots.get(key);
          if (!cur) return;
          cur.count = Math.max(0, cur.count - 1);
          if (cur.count === 0) slots.delete(key);
        },
      };
    },
  };
}

// ─── Singleton + public API ────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __nexusRateLimitBackend: RateLimitBackend | undefined;
}

function backend(): RateLimitBackend {
  if (!globalThis.__nexusRateLimitBackend) {
    const url = process.env.REDIS_URL;
    globalThis.__nexusRateLimitBackend = url
      ? buildRedisBackend(url)
      : buildMemoryBackend();
  }
  return globalThis.__nexusRateLimitBackend;
}

/**
 * Fixed-window token consumption. Returns `allowed: false` with a
 * `retryAfterMs` hint once the window is exhausted.
 *
 * @param userId  Opaque session id or user id. Namespacing is caller-owned.
 * @param endpoint  Endpoint label (e.g. 'login', 'exec', 'scripts.run'). Keys
 *                  are scoped per endpoint so one noisy endpoint can't
 *                  exhaust budget for another.
 * @param limit  Maximum tokens per window.
 * @param windowMs  Window length in milliseconds.
 */
export async function takeToken(
  userId: string,
  endpoint: string,
  limit: number,
  windowMs: number,
): Promise<TakeTokenResult> {
  const key = `${endpoint}:${userId}`;
  return backend().take(key, limit, windowMs);
}

/**
 * Acquire a concurrency slot. Returns null if `max` in-flight has already
 * been reached for this (user, endpoint) pair. Otherwise returns a handle
 * whose `release()` MUST be called in a try/finally block — leaks are
 * recovered only after `ttlMs`, so long leaks effectively deadlock the
 * user's slots until the TTL expires.
 *
 * @param ttlMs  Upper bound on how long a single slot can be held before
 *               the safety TTL reclaims it. Should exceed the longest
 *               legitimate operation duration (e.g. EXEC_LIMITS.maxTimeoutMs
 *               plus a small margin).
 */
export async function acquireSlot(
  userId: string,
  endpoint: string,
  max: number,
  ttlMs: number,
): Promise<Slot | null> {
  const key = `${endpoint}:${userId}`;
  return backend().acquire(key, max, ttlMs);
}

// ─── Policy constants (2-3 trusted operators profile) ──────────────────────

/**
 * Policy values picked for the "2-3 trusted operators" profile from the
 * security audit. Per-user limits only — no global ceilings needed for
 * small trust groups. Adjust here, not at call sites, if policy changes.
 */
export const RATE_LIMITS = {
  /** Login brute-force guard: 10 failures per 5-min window per session key. */
  login: { limit: 10, windowMs: 5 * 60_000 },

  /** /api/scripts/run — legitimate batch installs fit comfortably. */
  scriptsRun: { limit: 30, windowMs: 60_000, maxConcurrent: 5 },

  /** /api/exec — tighter because it's the higher-trust surface. */
  exec: { limit: 20, windowMs: 60_000, maxConcurrent: 3 },
} as const;

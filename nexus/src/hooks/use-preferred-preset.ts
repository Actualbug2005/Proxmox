'use client';

/**
 * Cookie-backed preference for which dashboard preset a user lands on.
 *
 * Kept as a cookie (not server-side storage) because:
 *   - It's a single-key, low-stakes preference.
 *   - Homelab profile is 2-3 operators; cross-browser sync isn't worth
 *     the cost of a new persisted store + GET/PATCH endpoint pair.
 *   - A missing / malformed cookie falls back to the default preset,
 *     which is the safe behaviour anyway.
 *
 * Implemented via useSyncExternalStore so the server-rendered HTML
 * deterministically uses the default (getServerSnapshot) and the
 * client snaps to the cookie value on hydration — with no
 * setState-in-effect churn.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_PRESET_ID, PRESETS } from '@/lib/widgets/presets';
import type { BentoPreset } from '@/lib/widgets/registry';

const COOKIE_NAME = 'nexus.dashboard.preset';
const ONE_YEAR_S = 60 * 60 * 24 * 365;

function readCookie(): BentoPreset['id'] {
  if (typeof document === 'undefined') return DEFAULT_PRESET_ID;
  const prefix = `${COOKIE_NAME}=`;
  const raw = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  if (!raw) return DEFAULT_PRESET_ID;
  const value = decodeURIComponent(raw.slice(prefix.length));
  return value in PRESETS ? (value as BentoPreset['id']) : DEFAULT_PRESET_ID;
}

function writeCookie(id: BentoPreset['id']): void {
  if (typeof document === 'undefined') return;
  // SameSite=Lax: this preference doesn't leave the Nexus origin, but
  // Lax avoids the edge case where a third-party iframe overrides it.
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
}

// ─── External store plumbing ─────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyAll(): void {
  for (const cb of listeners) cb();
}

/**
 * The cookie itself is the source of truth; getSnapshot just re-reads
 * it. Re-reading on every render is cheap (one document.cookie scan)
 * and avoids a stale closure problem if another tab writes the cookie.
 */
function getSnapshot(): BentoPreset['id'] {
  return readCookie();
}

function getServerSnapshot(): BentoPreset['id'] {
  return DEFAULT_PRESET_ID;
}

export function usePreferredPreset(): [BentoPreset['id'], (next: BentoPreset['id']) => void] {
  const id = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback((next: BentoPreset['id']) => {
    writeCookie(next);
    notifyAll();
  }, []);

  return [id, update];
}

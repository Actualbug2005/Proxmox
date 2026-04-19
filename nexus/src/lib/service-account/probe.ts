import type { Dispatcher } from 'undici';
import { pveFetchWithToken } from '../pve-fetch.ts';
import type { ServiceAccountSession } from './types.ts';

const PROBE_TIMEOUT_MS = 5000;

/**
 * Unwrap a thrown fetch error into something an operator can act on.
 *
 * Node's global fetch (undici) throws `TypeError: fetch failed` and hides
 * the real reason — DNS failure, connection refused, TLS mismatch, timeout
 * — on `err.cause`. The default `.message` is useless on its own. Walk
 * the cause chain and prepend whatever we find.
 */
function describeFetchError(err: unknown, url: string): string {
  const target = `${url}`;
  let cur: unknown = err;
  const messages: string[] = [];
  const seen = new Set<unknown>();
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof e.message === 'string' && e.message) messages.push(e.message);
    if (typeof e.code === 'string' && e.code) messages.push(`(${e.code})`);
    cur = e.cause;
  }
  const detail = messages.length > 0 ? messages.join(' → ') : String(err);
  return `Could not reach ${target}: ${detail}`;
}

export async function probeServiceAccount(
  session: ServiceAccountSession,
  initOverride?: { dispatcher?: Dispatcher },
): Promise<{ ok: true; userid: string } | { ok: false; error: string }> {
  const userid = session.tokenId;
  const url = `https://${session.proxmoxHost}:8006/api2/json/access/permissions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await pveFetchWithToken(session, url, {
      signal: controller.signal,
      ...(initOverride ?? {}),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body || res.statusText}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    if (!json || !json.data) {
      return { ok: false, error: 'PVE returned a success response with no data map' };
    }
    return { ok: true, userid };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, error: `Timed out after ${PROBE_TIMEOUT_MS}ms reaching ${url}` };
    }
    return { ok: false, error: describeFetchError(err, url) };
  } finally {
    clearTimeout(timer);
  }
}

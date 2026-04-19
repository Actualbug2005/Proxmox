/**
 * QEMU guest-agent probe — thin wrapper around two PVE endpoints:
 *
 *   POST /api2/json/nodes/{node}/qemu/{vmid}/agent/ping
 *   GET  /api2/json/nodes/{node}/qemu/{vmid}/agent/get-fsinfo
 *
 * `ping` is a QMP no-op that tells us the agent is alive inside the
 * guest. `get-fsinfo` enumerates every mounted filesystem with size /
 * used bytes — the only thing we need for disk pressure detection.
 *
 * Keep this pure I/O — no store writes, no event emission. Callers
 * (the probe-source poll loop + the on-demand API route) decide what
 * to do with the result.
 */

import { pveFetch, pveFetchWithToken } from '../pve-fetch.ts';
import type { PVEAuthSession } from '../../types/proxmox.ts';
import type { ServiceAccountSession } from '../service-account/types.ts';
import type { GuestFilesystem, GuestProbe } from './types.ts';

/**
 * The probe accepts either a user-auth PVE ticket session (used by the
 * on-demand HTTP route via `withAuth`) or the background service-account
 * session (used by the scheduled poll source). They're discriminated by
 * presence of `tokenId` — API tokens don't need CSRF, tickets do.
 */
type ProbeSession = PVEAuthSession | ServiceAccountSession;

function isTokenSession(s: ProbeSession): s is ServiceAccountSession {
  return (s as ServiceAccountSession).tokenId !== undefined;
}

interface ProbeArgs {
  session: ProbeSession;
  node: string;
  vmid: number;
  /** Request timeout in ms. QMP agents can hang for a long time if the
   *  guest is frozen; we bound the whole probe aggressively. Default 5s. */
  timeoutMs?: number;
}

/**
 * Raw shape from `guest-get-fsinfo`. PVE wraps QMP replies in `{ data: [...] }`
 * and the QMP protocol uses hyphenated field names — normalise here so
 * the rest of the app deals with camelCase.
 */
interface RawFsinfo {
  mountpoint: string;
  type: string;
  'total-bytes'?: number;
  'used-bytes'?: number;
}

function normaliseFs(raw: RawFsinfo): GuestFilesystem | null {
  // Some agent versions omit total/used on pseudo-filesystems (tmpfs,
  // devtmpfs). Those aren't useful for pressure detection — drop them
  // rather than projecting usedPct=NaN into the UI.
  const total = raw['total-bytes'];
  const used = raw['used-bytes'];
  if (typeof total !== 'number' || typeof used !== 'number' || total <= 0) {
    return null;
  }
  return {
    mountpoint: raw.mountpoint,
    type: raw.type ?? 'unknown',
    totalBytes: total,
    usedBytes: used,
  };
}

async function fetchWithTimeout(
  session: ProbeSession,
  url: string,
  init: Parameters<typeof pveFetch>[1],
  timeoutMs: number,
): Promise<Response | Awaited<ReturnType<typeof pveFetch>>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    if (isTokenSession(session)) {
      // Token auth — strip any ticket Cookie/CSRF header the caller tried
      // to set; pveFetchWithToken owns the Authorization header. Pass only
      // method/body/signal through; headers are rebuilt per-call so any
      // DOM-vs-undici type mismatch on the merged init object is moot.
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const src = new Headers(init.headers as HeadersInit | undefined);
        src.forEach((value, key) => {
          if (key.toLowerCase() === 'cookie' || key.toLowerCase() === 'csrfpreventiontoken') return;
          headers[key] = value;
        });
      }
      return await pveFetchWithToken(session, url, {
        method: init?.method,
        body: init?.body as string | undefined,
        headers,
        signal: ac.signal,
      });
    }
    return await pveFetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one guest. Always resolves — network / timeout / PVE errors are
 * captured as `{ reachable: false, reason }` so the poll source can
 * aggregate a whole cluster without try/catch at every site.
 */
export async function probeGuest({
  session,
  node,
  vmid,
  timeoutMs = 5000,
}: ProbeArgs): Promise<GuestProbe> {
  const base = `https://${session.proxmoxHost}:8006/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent`;
  // Ticket-auth needs Cookie + CSRF; token-auth paths ignore these because
  // fetchWithTimeout strips them and calls pveFetchWithToken (Authorization
  // header only, no CSRF since the secret IS the credential).
  const headers: Record<string, string> = isTokenSession(session)
    ? {}
    : {
        Cookie: `PVEAuthCookie=${session.ticket}`,
        CSRFPreventionToken: session.csrfToken,
      };

  // Step 1 — ping. Cheap, tells us the agent is up before we spend time
  // on fsinfo. `ping` is a POST with an empty body in PVE's agent API.
  try {
    const pingRes = await fetchWithTimeout(
      session,
      `${base}/ping`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      },
      timeoutMs,
    );
    if (!pingRes.ok) {
      const text = await pingRes.text().catch(() => '');
      return {
        vmid,
        node,
        reachable: false,
        reason: `agent ping: ${pingRes.status} ${pingRes.statusText}${text ? `: ${text.slice(0, 120)}` : ''}`,
      };
    }
  } catch (err) {
    return {
      vmid,
      node,
      reachable: false,
      reason: err instanceof Error && err.name === 'AbortError'
        ? 'agent ping timeout'
        : `agent ping: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 2 — fsinfo. Agent is alive; if this fails we still consider the
  // guest "reachable" (agent responded to ping) but return an empty fs
  // list with the reason attached, so the UI distinguishes "stale data"
  // from "unreachable agent".
  try {
    const res = await fetchWithTimeout(session, `${base}/get-fsinfo`, { headers }, timeoutMs);
    if (!res.ok) {
      return {
        vmid,
        node,
        reachable: true,
        reason: `fsinfo: ${res.status} ${res.statusText}`,
        filesystems: [],
      };
    }
    const json = (await res.json()) as { data?: { result?: RawFsinfo[] } | RawFsinfo[] };
    // PVE nests the QMP result under `data.result`; older releases returned
    // `data` directly as the array. Accept both.
    const raw = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.data?.result)
        ? json.data!.result!
        : [];
    const filesystems = raw
      .map(normaliseFs)
      .filter((f): f is GuestFilesystem => f !== null);
    return { vmid, node, reachable: true, filesystems };
  } catch (err) {
    return {
      vmid,
      node,
      reachable: true,
      reason: err instanceof Error && err.name === 'AbortError'
        ? 'fsinfo timeout'
        : `fsinfo: ${err instanceof Error ? err.message : String(err)}`,
      filesystems: [],
    };
  }
}

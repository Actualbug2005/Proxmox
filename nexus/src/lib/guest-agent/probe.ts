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
import { parseFailedUnits } from './services-probe.ts';
import type { GuestFailedService, GuestFilesystem, GuestProbe } from './types.ts';

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
  /** Opt-in services probe. Runs `systemctl list-units --state=failed` via
   *  `/agent/exec` after a successful base probe. Default false so existing
   *  callers (the on-demand route) don't suddenly pay the cost. The poll
   *  source opts in on a 1/3 cadence — see `SERVICES_PROBE_EVERY_N_TICKS`. */
  probeServices?: boolean;
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
  probeServices = false,
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
  let probe: GuestProbe;
  try {
    const res = await fetchWithTimeout(session, `${base}/get-fsinfo`, { headers }, timeoutMs);
    if (!res.ok) {
      probe = {
        vmid,
        node,
        reachable: true,
        reason: `fsinfo: ${res.status} ${res.statusText}`,
        filesystems: [],
      };
    } else {
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
      probe = { vmid, node, reachable: true, filesystems };
    }
  } catch (err) {
    probe = {
      vmid,
      node,
      reachable: true,
      reason: err instanceof Error && err.name === 'AbortError'
        ? 'fsinfo timeout'
        : `fsinfo: ${err instanceof Error ? err.message : String(err)}`,
      filesystems: [],
    };
  }

  // Step 3 — optional services probe (1/3 cadence from the poll source).
  // Only run if the base probe was reachable; leaves `failedServices`
  // undefined on off-ticks or on its own failures, so `processProbes` can
  // distinguish "skipped this tick" from "probed and saw zero failures"
  // (which would be `[]`).
  if (probeServices && probe.reachable) {
    try {
      const failedServices = await probeFailedServices(session, base, headers, timeoutMs);
      probe.failedServices = failedServices;
    } catch (err) {
      console.warn(
        '[nexus event=guest_services_probe_failed] vmid=%d reason=%s',
        vmid,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return probe;
}

// ─── Services probe (systemctl via /agent/exec) ──────────────────────────
//
// PVE wraps QMP's guest-exec / guest-exec-status under these two endpoints:
//   POST /api2/json/nodes/{node}/qemu/{vmid}/agent/exec
//        body: command=<binary>&command=<arg>&command=<arg>…
//        returns { data: { pid: number } }
//   GET  /api2/json/nodes/{node}/qemu/{vmid}/agent/exec-status?pid={pid}
//        returns { data: { exited, exitcode, out-data (base64), err-data } }
//
// We kick off `systemctl list-units --state=failed …`, poll exec-status at
// short intervals until `exited=1` or the overall timeout trips, then
// base64-decode `out-data` and hand it to `parseFailedUnits`.

const SERVICES_POLL_INTERVAL_MS = 250;

async function probeFailedServices(
  session: ProbeSession,
  base: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<GuestFailedService[]> {
  // Build form-encoded body. PVE expects one `command=` pair per argv
  // element so we don't let the guest-agent do its own shell-style split.
  const argv = [
    'systemctl',
    'list-units',
    '--state=failed',
    '--no-legend',
    '--plain',
    '--no-pager',
  ];
  const execBody = argv.map((a) => `command=${encodeURIComponent(a)}`).join('&');

  const execRes = await fetchWithTimeout(
    session,
    `${base}/exec`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: execBody,
    },
    timeoutMs,
  );
  if (!execRes.ok) {
    throw new Error(`exec: ${execRes.status} ${execRes.statusText}`);
  }
  const execJson = (await execRes.json()) as { data?: { pid?: number } };
  const pid = execJson.data?.pid;
  if (typeof pid !== 'number') {
    throw new Error('exec: missing pid');
  }

  // Poll exec-status. Overall deadline bounded by timeoutMs; exec itself
  // fires-and-forgets so the only way we learn the command finished is to
  // keep checking `exited`.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const statusRes = await fetchWithTimeout(
      session,
      `${base}/exec-status?pid=${pid}`,
      { headers },
      Math.max(500, deadline - Date.now()),
    );
    if (!statusRes.ok) {
      throw new Error(`exec-status: ${statusRes.status} ${statusRes.statusText}`);
    }
    const statusJson = (await statusRes.json()) as {
      data?: { exited?: 0 | 1 | boolean; 'out-data'?: string };
    };
    const data = statusJson.data ?? {};
    if (data.exited === 1 || data.exited === true) {
      const outB64 = data['out-data'] ?? '';
      const stdout = outB64 ? Buffer.from(outB64, 'base64').toString('utf8') : '';
      return parseFailedUnits(stdout).map((p) => ({ ...p, since: 0 }));
    }
    if (Date.now() >= deadline) {
      throw new Error('exec-status timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, SERVICES_POLL_INTERVAL_MS));
  }
}

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
import { startSchedulerSource, type SchedulerSource } from './src/lib/scheduler.ts';
import { runScriptJob } from './src/lib/run-script-job.ts';
import * as scheduledJobsStore from './src/lib/scheduled-jobs-store.ts';
import * as chainsStore from './src/lib/chains-store.ts';
import { runChain } from './src/lib/run-chain.ts';
import { attach as attachNotificationDispatcher } from './src/lib/notifications/dispatcher.ts';
import { startPollSource as startNotificationPollSource } from './src/lib/notifications/poll-source.ts';
import { runTick as runDrsTick } from './src/lib/drs/runner.ts';
import { startPollSource as startGuestPollSource } from './src/lib/guest-agent/poll-source.ts';
import { runTick as runUpdatesTick } from './src/lib/updates/checker.ts';
import {
  loadServiceAccountAtBoot,
  getServiceSession,
} from './src/lib/service-account/session.ts';
import { pveFetchWithToken } from './src/lib/pve-fetch.ts';
import type { ClusterResourcePublic, NodeStatus, PVETask } from './src/types/proxmox.ts';
import { readFile as fsReadFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
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
  /**
   * Backend protocol we're bridging.
   *
   *   'shell' — PVE termproxy (xterm over WS). After the WS upgrade, the
   *             backend expects the FIRST frame to be "user:ticket\n"
   *             (see proxmox-termproxy/src/main.rs::read_ticket()).
   *             Without it, termproxy hangs until its own timeout.
   *
   *   'vnc'   — PVE vncproxy (QEMU/LXC graphical console over WS). The
   *             vncticket query param has already authenticated the
   *             connection by the time the WS upgrade completes, and
   *             the raw RFB (VNC) protocol starts on the first byte
   *             the guest sends. Writing "user:ticket\n" here would
   *             corrupt the RFB handshake and make noVNC fail with a
   *             "server rejected version" error.
   *
   *   Default: 'shell' for backward compat with termproxy callers that
   *   predate the VNC branch.
   */
  mode?: 'shell' | 'vnc';
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const {
      sessionId,
      pveHost,
      pvePort,
      pveWsPath,
      ticket,
      ticketPort,
      pveAuthCookie,
      username,
      mode = 'shell',
    } = params;

    // Connect through pveproxy's vncwebsocket endpoint — pveproxy validates
    // the vncticket query param then bridges to the local termproxy or
    // vncproxy TCP port depending on which API produced the ticket.
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

    // H7: timer cleared on success/error so a late-OPEN doesn't terminate a
    // live socket and a settled error doesn't fire a spurious terminate.
    const connectTimeout = setTimeout(() => {
      if (pveWs.readyState !== WebSocket.OPEN) {
        pveWs.terminate();
        reject(new Error('PVE WebSocket timed out'));
      }
    }, 8_000);

    pveWs.on('open', () => {
      clearTimeout(connectTimeout);
      if (mode === 'shell') {
        // termproxy protocol preamble — see the mode JSDoc above for why
        // this is required here but MUST be skipped in VNC mode.
        pveWs.send(`${username}:${ticket}\n`);
      }
      relaySessions.set(sessionId, session);
      resolve();
    });

    pveWs.on('message', (data) => {
      if (!session.clientWs) {
        session.buffer.push(data as Buffer | string);
      }
    });

    pveWs.on('error', (err) => {
      clearTimeout(connectTimeout);
      // Drop any half-registered session so a late join doesn't attach to a
      // dead socket (M18). Safe even if 'open' never fired.
      relaySessions.delete(sessionId);
      reject(err);
    });
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
app.prepare().then(async () => {
  const httpServer = createServer((req, res) => {
    // Next.js does its own URL parsing internally when parsedUrl is omitted,
    // so we don't need to duplicate it here. Dropping the legacy url.parse()
    // call also kills DEP0169 at runtime.
    handle(req, res);
  });

  // Explicit subprotocol negotiation. noVNC requests `binary` and pveproxy's
  // vncwebsocket advertises it server-side — we must echo it back on the
  // client-facing socket or some browsers abort the handshake without
  // emitting a close event, leaving noVNC stuck in "Connecting...". When the
  // browser sends no Sec-WebSocket-Protocol header at all (e.g. xterm path),
  // we return `false` to proceed without a subprotocol.
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => {
      if (protocols.has('binary')) return 'binary';
      return false;
    },
  });

  // Expose a live count of connected noVNC / xterm sockets so the
  // auto-update safety-rail check can refuse to restart the process
  // out from under an active console session. Read-only peek; the
  // updates checker calls this on each tick.
  (globalThis as unknown as { __nexusActiveSocketCount?: () => number })
    .__nexusActiveSocketCount = () => wss.clients.size;

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

      // Per-session byte/message counters. First-message hex of whichever
      // side speaks first pinpoints handshake stalls (e.g. if PVE sends
      // zero bytes for 15s, RFB can't advance — visible here).
      let pveToClientBytes = 0;
      let clientToPveBytes = 0;
      let pveFirstLogged = false;
      let clientFirstLogged = false;

      const logFirstFrom = (who: 'PVE' | 'client', data: Buffer | string): void => {
        const buf = typeof data === 'string' ? Buffer.from(data) : data;
        const head = buf.subarray(0, Math.min(32, buf.length));
        console.log('[ws-relay] %s first-%s bytes=%d head=%s', sessionId, who, buf.length, head.toString('hex'));
      };

      // Flush buffered data (anything PVE sent before the client joined).
      for (const chunk of buffer) {
        if (!pveFirstLogged) { logFirstFrom('PVE', chunk as Buffer | string); pveFirstLogged = true; }
        pveToClientBytes += (chunk as Buffer).length ?? 0;
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(chunk);
      }
      console.log('[ws-relay] %s joined, flushed %d buffered chunks', sessionId, buffer.length);
      session.buffer = [];

      pveWs.on('message', (data) => {
        const buf = data as Buffer;
        if (!pveFirstLogged) { logFirstFrom('PVE', buf); pveFirstLogged = true; }
        pveToClientBytes += buf.length ?? 0;
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(buf);
      });
      clientWs.on('message', (data) => {
        const buf = data as Buffer;
        if (!clientFirstLogged) { logFirstFrom('client', buf); clientFirstLogged = true; }
        clientToPveBytes += buf.length ?? 0;
        if (pveWs.readyState === WebSocket.OPEN) pveWs.send(buf);
      });
      // Log format uses %s placeholders (not string concatenation) so
      // untrusted remote values never reach util.format as format specifiers
      // — appeases semgrep CWE-134 and is also just the correct logging API.
      clientWs.on('close', (code, reason) => {
        console.log('[ws-relay] %s client closed code=%d reason=%s pveTx=%d clientTx=%d', sessionId, code, reason.toString(), pveToClientBytes, clientToPveBytes);
        pveWs.close();
        relaySessions.delete(sessionId);
      });
      clientWs.on('error', (err) => {
        console.error('[ws-relay] %s client error: %s pveTx=%d clientTx=%d', sessionId, err.message, pveToClientBytes, clientToPveBytes);
        pveWs.close();
        relaySessions.delete(sessionId);
      });
      pveWs.on('close', (code, reason) => {
        console.log('[ws-relay] %s PVE closed code=%d reason=%s pveTx=%d clientTx=%d', sessionId, code, reason?.toString() ?? '', pveToClientBytes, clientToPveBytes);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, 'PVE closed');
        relaySessions.delete(sessionId);
      });
      pveWs.on('error', (err) => {
        console.error('[ws-relay] %s PVE error: %s', sessionId, err.message);
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

  const scriptsSource: SchedulerSource<scheduledJobsStore.ScheduledJob> = {
    name: 'scripts',
    list: () => scheduledJobsStore.list(),
    getId: (j) => j.id,
    getSchedule: (j) => j.schedule,
    isEnabled: (j) => j.enabled,
    getLastFiredAt: (j) => j.lastFiredAt,
    getConsecutiveFailures: (j) => j.consecutiveFailures,
    onFired: (id, at, result) =>
      scheduledJobsStore.markFired(id, result.jobId, at, result.error),
    disable: async (id) => {
      await scheduledJobsStore.update(id, { enabled: false });
    },
    historySource: 'schedule',
  };
  startSchedulerSource(scriptsSource, async (job) => {
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

  // Chain scheduler — independent source so its dedup/tick state doesn't
  // entangle with single-script schedules. `runChain` is fire-and-forget
  // at the caller level; the handler just kicks it off and returns.
  const chainsSource: SchedulerSource<chainsStore.Chain> = {
    name: 'chains',
    list: () => chainsStore.list(),
    getId: (c) => c.id,
    getSchedule: (c) => c.schedule,
    isEnabled: (c) => c.enabled,
    getLastFiredAt: (c) => c.lastFiredAt,
    getConsecutiveFailures: (c) => c.consecutiveFailures,
    onFired: (id, at, result) => chainsStore.markFired(id, at, result.error),
    disable: async (id) => {
      await chainsStore.update(id, { enabled: false });
    },
    historySource: 'chain',
  };
  startSchedulerSource(chainsSource, async (chain) => {
    runChain(chain);
    return {};
  });

  // ── Notification engine ──────────────────────────────────────────────────
  // Wire the dispatcher onto the event bus so every emit() from
  // instrumented sites (auth, permissions, exec-audit, scheduler,
  // session-store) gets matched against rules + POSTed to destinations.
  // No awaited handler — the bus is fire-and-forget.
  attachNotificationDispatcher();

  // Load the service-account session singleton before any ticker starts.
  // If no token is configured, getServiceSession() returns null and each
  // ticker falls through to its empty-shape branch — the tick still runs
  // so the history-entry contract stays consistent; it just records a
  // clean "no session" state rather than silent no-op. Operator pastes a
  // token via /settings/service-account → /api/service-account POST
  // calls reloadServiceAccount() and the next tick picks it up.
  await loadServiceAccountAtBoot();

  // Shared snapshot fetcher for the notification & DRS tickers — both
  // need `/cluster/resources`; DRS additionally needs per-node status
  // for free-capacity calc, notifications needs loadavg in the same
  // node-status shape. Fanning out to every node for /status is O(N)
  // but N is small (homelab <10) and this only runs once per tick.
  async function fetchClusterSnapshot(): Promise<{
    resources: ClusterResourcePublic[];
    nodeStatuses: Record<string, NodeStatus | undefined>;
    tasks: PVETask[];
  }> {
    const session = getServiceSession();
    if (!session) return { resources: [], nodeStatuses: {}, tasks: [] };
    try {
      const host = session.proxmoxHost;
      const resourcesRes = await pveFetchWithToken(
        session,
        `https://${host}:8006/api2/json/cluster/resources`,
      );
      if (!resourcesRes.ok) throw new Error(`cluster/resources ${resourcesRes.status}`);
      const resources =
        ((await resourcesRes.json()) as { data?: ClusterResourcePublic[] }).data ?? [];

      // Per-node /status — fan out bounded by the node count, swallow
      // individual failures so one flaky node doesn't blank the whole tick.
      const nodeStatuses: Record<string, NodeStatus | undefined> = {};
      const nodes = resources.filter((r) => r.type === 'node' && r.status === 'online');
      await Promise.all(
        nodes.map(async (n) => {
          const name = n.node ?? n.id;
          try {
            const res = await pveFetchWithToken(
              session,
              `https://${host}:8006/api2/json/nodes/${encodeURIComponent(name)}/status`,
            );
            if (!res.ok) return;
            nodeStatuses[name] = ((await res.json()) as { data?: NodeStatus }).data;
          } catch { /* per-node best-effort */ }
        }),
      );

      // Tasks aren't consumed by the current poll-source logic (the
      // `_tasks` arg in runTick is intentionally unused today), so skip
      // the fetch to avoid an extra round-trip every minute.
      return { resources, nodeStatuses, tasks: [] };
    } catch (err) {
      console.error(
        '[nexus event=cluster_snapshot_failed] reason=%s',
        err instanceof Error ? err.message : String(err),
      );
      return { resources: [], nodeStatuses: {}, tasks: [] };
    }
  }

  startNotificationPollSource({ fetchState: fetchClusterSnapshot });

  // ── Auto-DRS (5.3) ───────────────────────────────────────────────────────
  // Standalone 60s ticker. When no service-account session is configured,
  // fetchClusterSnapshot returns empty — the planner sees no hot nodes
  // and the runner records `no-action` in history. Operator visibility
  // via /dashboard/cluster/drs stays coherent.
  const drsTimer = setInterval(() => {
    void (async () => {
      try {
        const snap = await fetchClusterSnapshot();
        await runDrsTick({
          fetchCluster: async () => ({
            resources: snap.resources,
            nodeStatuses: snap.nodeStatuses,
          }),
          session: getServiceSession(),
        });
      } catch (err) {
        console.error(
          '[nexus event=drs_tick_failed] reason=%s',
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, 60_000);
  drsTimer.unref?.();

  // ── Guest-agent probes (5.2) ─────────────────────────────────────────────
  // fetchGuests enumerates QEMU guests that have the agent enabled in
  // their runtime config — PVE reports `agent` as 0|1 on running VMs in
  // cluster/resources. LXC deferred (see probe module header).
  startGuestPollSource({
    getSession: () => getServiceSession(),
    fetchGuests: async () => {
      const session = getServiceSession();
      if (!session) return [];
      try {
        const res = await pveFetchWithToken(
          session,
          `https://${session.proxmoxHost}:8006/api2/json/cluster/resources?type=vm`,
        );
        if (!res.ok) throw new Error(`cluster/resources ${res.status}`);
        const data =
          ((await res.json()) as {
            data?: Array<{
              type: string;
              status?: string;
              template?: 0 | 1;
              node?: string;
              vmid?: number;
              agent?: number | string;
            }>;
          }).data ?? [];
        return data
          .filter(
            (g) =>
              g.type === 'qemu' &&
              g.template !== 1 &&
              g.status === 'running' &&
              (g.agent === 1 || g.agent === '1') &&
              typeof g.node === 'string' &&
              typeof g.vmid === 'number',
          )
          .map((g) => ({ node: g.node as string, vmid: g.vmid as number }));
      } catch (err) {
        console.error(
          '[nexus event=guest_fleet_fetch_failed] reason=%s',
          err instanceof Error ? err.message : String(err),
        );
        return [];
      }
    },
  });

  // ── Auto-update checker ─────────────────────────────────────────────────
  // Reads the persisted policy every minute. The cron inside the policy
  // is what actually gates network traffic — mode=off short-circuits
  // before the GitHub probe; cron-miss exits even cheaper.
  //
  // The seams match server-local I/O:
  //   - readCurrentVersion: mirrors /api/system/version's VERSION file
  //     reader. 'dev' is returned when the file is absent (running
  //     from a git clone) so the delta classifier short-circuits to
  //     `null` and we stay in notify-only mode.
  //   - fetchLatestRelease: GitHub releases API. Honours `channel` by
  //     hitting `/releases/latest` (excludes pre-releases) or
  //     `/releases?per_page=1` (includes them).
  //   - getSignals: assembles the three safety-rail inputs from
  //     script-jobs, DRS history, and the live WS counter.
  //   - runInstaller: execFile into /usr/local/bin/nexus-update — the
  //     same argv-only contract the existing /api/system/update POST
  //     uses. No shell, no environment leakage.
  const execFileAsync = promisify(execFileCb);
  const UPDATE_REPO = process.env.NEXUS_REPO ?? 'Actualbug2005/Proxmox';
  const UPDATE_VERSION_FILE = process.env.NEXUS_VERSION_FILE ?? '/opt/nexus/current/VERSION';
  const UPDATER_BIN = process.env.NEXUS_UPDATER_BIN ?? '/usr/local/bin/nexus-update';

  const drsHistoryForUpdater = await import('./src/lib/drs/store.ts');

  const updatesTimer = setInterval(() => {
    void (async () => {
      try {
        await runUpdatesTick({
          readCurrentVersion: async () => {
            try {
              return (await fsReadFile(UPDATE_VERSION_FILE, 'utf8')).trim() || 'dev';
            } catch {
              return 'dev';
            }
          },
          fetchLatestRelease: async (channel) => {
            const url =
              channel === 'prerelease'
                ? `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=1`
                : `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
            try {
              const res = await fetch(url, {
                headers: {
                  Accept: 'application/vnd.github+json',
                  'X-GitHub-Api-Version': '2022-11-28',
                  'User-Agent': `nexus/${UPDATE_REPO}`,
                },
                signal: AbortSignal.timeout(5_000),
              });
              if (!res.ok) return null;
              const body = (await res.json()) as
                | { tag_name?: string; html_url?: string }
                | Array<{ tag_name?: string; html_url?: string }>;
              const rel = Array.isArray(body) ? body[0] : body;
              if (!rel?.tag_name) return null;
              return { tag: rel.tag_name, url: rel.html_url ?? '' };
            } catch {
              return null;
            }
          },
          getSignals: async () => {
            const { countRunningJobs } = await import('./src/lib/script-jobs.ts');
            const history = await drsHistoryForUpdater.recentHistory(5);
            const tenMinAgo = Date.now() - 10 * 60_000;
            const drsMigrationInFlight = history.some(
              (h) => h.outcome === 'moved' && h.at >= tenMinAgo,
            );
            const activeConsoleSockets =
              (globalThis as unknown as { __nexusActiveSocketCount?: () => number })
                .__nexusActiveSocketCount?.() ?? 0;
            return {
              scriptJobsRunning: countRunningJobs(),
              drsMigrationInFlight,
              activeConsoleSockets,
            };
          },
          runInstaller: async (version) => {
            try {
              await execFileAsync(UPDATER_BIN, ['--version', version], {
                timeout: 120_000,
                maxBuffer: 4 * 1024 * 1024,
              });
              return { ok: true };
            } catch (err) {
              return {
                ok: false,
                reason: err instanceof Error ? err.message : String(err),
              };
            }
          },
        });
      } catch (err) {
        console.error(
          '[nexus event=updates_tick_failed] reason=%s',
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, 60_000);
  updatesTimer.unref?.();
});

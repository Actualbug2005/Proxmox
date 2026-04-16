import { NextRequest, NextResponse } from 'next/server';
import { acquirePVETicket, startSession } from '@/lib/auth';
import { takeToken, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Phase 2 hardening on this route:
 *
 *  H2  — Per-(ip, username) rate limit via the existing leaky-bucket store.
 *        Infrastructure (CrowdSec at layer 3/4) is the primary control;
 *        this is the app-level fallback for interim deployments where the
 *        ingress hasn't been deployed yet.
 *
 *  H3  — Login error responses are now uniformly "Invalid credentials" with
 *        status 401, regardless of whether PVE returned 401, the network
 *        timed out, the host was unreachable, or the request body was
 *        malformed. The real error goes to stderr as a structured log line
 *        that CrowdSec's custom parser consumes (see deploy/crowdsec/
 *        parsers/nexus-login.yaml).
 *
 * TLS verification for PVE's self-signed cert is handled inside pveFetch
 * (src/lib/pve-fetch.ts). No process-global NODE_TLS_REJECT_UNAUTHORIZED.
 */

interface LoginBody {
  username?: unknown;
  password?: unknown;
  realm?: unknown;
  // Note: `host` field intentionally ignored — login always uses
  // process.env.PROXMOX_HOST. Previous SSRF-lite surface via client-supplied
  // host is closed. If a multi-cluster deployment is ever needed, add
  // NEXUS_ALLOWED_HOSTS env + server-side allowlist check here.
}

function clientIp(req: NextRequest): string {
  // X-Forwarded-For is the canonical reverse-proxy header; take the first
  // entry (the originating client; subsequent entries are the proxy chain).
  // Trust this header ONLY when Nexus is behind a trusted ingress — in
  // direct-exposure deployments it's attacker-controlled and should be
  // replaced with the actual socket address. For the homelab target
  // architecture (Caddy/nginx/Traefik in front of Nexus), this is correct.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  // Final fallback — may be undefined in edge runtime; use a constant so the
  // rate-limit key is stable per unknown-origin cluster.
  return 'unknown';
}

/**
 * Emit a single structured JSON line to stderr. CrowdSec's parser reads
 * journald / stderr for these; fields line up with the nexus-login parser
 * YAML in deploy/crowdsec/.
 */
function logLoginEvent(event: {
  outcome: 'success' | 'fail' | 'ratelimited' | 'invalid';
  ip: string;
  username?: string;
  realm?: string;
  reason?: string;
}): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: 'nexus',
      event: 'login',
      ...event,
    }),
  );
}

const GENERIC_ERROR = { error: 'Invalid credentials' } as const;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // ── Parse body safely ──────────────────────────────────────────────────
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    logLoginEvent({ outcome: 'invalid', ip, reason: 'malformed-json' });
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const realm = typeof body.realm === 'string' ? body.realm : 'pam';

  if (!username || !password) {
    logLoginEvent({ outcome: 'invalid', ip, reason: 'missing-credentials' });
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // ── Rate limit (H2) ────────────────────────────────────────────────────
  // Key on (ip, lower-cased username) so an attacker trying one username
  // across many IPs still burns quota per IP, and an IP trying many
  // usernames burns quota per (ip, user). CrowdSec observing the stderr
  // stream will also L3-drop the IP once its community scenarios fire.
  const rlKey = `${ip}:${username.toLowerCase()}`;
  const token = await takeToken(
    rlKey,
    'login',
    RATE_LIMITS.login.limit,
    RATE_LIMITS.login.windowMs,
  );
  if (!token.allowed) {
    logLoginEvent({ outcome: 'ratelimited', ip, username, realm });
    return NextResponse.json(GENERIC_ERROR, {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((token.retryAfterMs ?? 0) / 1000)),
      },
    });
  }

  // ── Acquire PVE ticket ─────────────────────────────────────────────────
  const proxmoxHost = process.env.PROXMOX_HOST ?? 'localhost';
  let ticket;
  try {
    ticket = await acquirePVETicket(proxmoxHost, username, password, realm);
  } catch (err) {
    // Log the real reason server-side for ops; surface only generic error
    // to the client so no SSRF-style probing or account enumeration leaks.
    logLoginEvent({
      outcome: 'fail',
      ip,
      username,
      realm,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // ── Session creation ───────────────────────────────────────────────────
  try {
    const { csrfToken } = await startSession({
      ticket: ticket.ticket,
      csrfToken: ticket.CSRFPreventionToken,
      username: ticket.username,
      proxmoxHost,
      ticketIssuedAt: Date.now(),
    });
    logLoginEvent({ outcome: 'success', ip, username: ticket.username, realm });
    return NextResponse.json({
      username: ticket.username,
      clustername: ticket.clustername,
      csrfToken,
    });
  } catch (err) {
    logLoginEvent({
      outcome: 'fail',
      ip,
      username,
      realm,
      reason: err instanceof Error ? err.message : 'session-start-failed',
    });
    return NextResponse.json(GENERIC_ERROR, { status: 500 });
  }
}

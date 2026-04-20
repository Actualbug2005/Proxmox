/**
 * Dynamic Proxmox API Proxy
 * Route: /api/proxmox/[...path]
 *
 * Forwards all HTTP methods to the PVE API at https://<host>:8006/api2/json/...
 * Injects PVEAuthCookie and CSRFPreventionToken from the server-side session.
 *
 * Phase 2 hardening:
 *   - Path-segment validation (H4): reject control chars, ".", "..", and any
 *     segment that would split the URL query/fragment.
 *   - Body size cap (M5): reject >10 MB request bodies with 413 before
 *     buffering the whole thing in memory.
 *   - Content-Type allow-list (M4): refuse unusual content types instead of
 *     blindly forwarding whatever the client sent.
 *   - Cache-Control no-store (M6): every authenticated response is marked
 *     uncacheable so no intermediate (future CDN, browser heuristic) retains
 *     privileged state.
 *   - Proactive PVE ticket refresh at 90 min (M1, landed in Phase 1).
 *   - Scoped TLS bypass via pveFetch (C1, landed in Phase 1).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId, refreshPVESessionIfStale } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { pveFetch } from '@/lib/pve-fetch';

const PVE_BASE = process.env.PROXMOX_HOST
  ? `https://${process.env.PROXMOX_HOST}:8006/api2/json`
  : 'https://localhost:8006/api2/json';

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// ── Hardening constants ─────────────────────────────────────────────────────

/** Max request body accepted by the proxy. JSON control-plane calls are
 *  small; binary uploads go through the dedicated /api/iso-upload route
 *  which has its own handling. 10 MB is generous for PVE's JSON shapes. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Content types the proxy will forward upstream. Anything outside this set
 *  is rejected with 415 rather than blindly passed to pveproxy. */
const ALLOWED_CONTENT_TYPES = new Set([
  'application/json',
  'application/x-www-form-urlencoded',
  'text/plain',
  // multipart/form-data NOT listed — that's the ISO upload path and has a
  // dedicated route (/api/iso-upload) with its own validation. Requests to
  // the generic proxy with multipart bodies are rejected.
]);

/** Top-level PVE resource families Nexus consumes. Anything else is 403.
 *  Adding a new family here is a conscious widening decision. */
export const ALLOWED_TOP_LEVEL = new Set([
  'cluster', 'nodes', 'storage', 'access', 'pools', 'version',
]);

/** Reject a path segment if it contains ANY of:
 *   - control chars (including \r, \n, NUL)
 *   - colon (could split scheme when URL-parsed downstream)
 *   - the literal ".." or "." (path traversal)
 *  The Next.js router decodes %XX sequences into path[i] before we see it,
 *  so these checks operate on the already-decoded bytes. */
function invalidSegment(seg: string): boolean {
  if (seg === '' || seg === '.' || seg === '..') return true;
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    // Control chars 0x00-0x1F, DEL 0x7F, and colon (0x3A).
    if (c < 0x20 || c === 0x7f || c === 0x3a) return true;
  }
  return false;
}

/**
 * Distinguish PVE's ticket-expiry 401 from a per-operation privilege denial.
 *
 * pveproxy returns plain-text "401 No ticket" / "Invalid ticket" /
 * "ticket expired" for ticket failures. Privilege denials are mostly 403,
 * but a few endpoints emit JSON 401 with privilege errors in the body —
 * those should not nuke the session (H10).
 */
function isTicketExpiryBody(contentType: string | null, body: string): boolean {
  if (contentType?.toLowerCase().includes('json')) return false;
  return /\b(no\s+ticket|invalid\s+ticket|ticket\s+expired)\b/i.test(body);
}

// ── Response builder with standard hardening headers ───────────────────────

function hardenedJson(
  body: unknown,
  init: { status: number; extraHeaders?: Record<string, string> },
): NextResponse {
  return NextResponse.json(body, {
    status: init.status,
    headers: {
      'Cache-Control': 'no-store, private',
      ...init.extraHeaders,
    },
  });
}

// ── Handler ────────────────────────────────────────────────────────────────

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const sessionId = await getSessionId();
  if (!sessionId) {
    return hardenedJson({ error: 'Unauthorized' }, { status: 401 });
  }
  if (MUTATING.has(req.method) && !validateCsrf(req, sessionId)) {
    return hardenedJson({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const rawSession = await getSession();
  if (!rawSession) {
    return hardenedJson({ error: 'Unauthorized' }, { status: 401 });
  }

  // Proactive PVE ticket refresh at 90-min threshold.
  const session = await refreshPVESessionIfStale(sessionId, rawSession);

  // ── Path validation (H4) ─────────────────────────────────────────────────
  const { path } = await params;
  for (const seg of path) {
    if (invalidSegment(seg)) {
      return hardenedJson(
        { error: 'Invalid path segment' },
        { status: 400 },
      );
    }
  }
  // ── Top-level resource allowlist (8.3) ──────────────────────────────────
  // Narrow the catch-all from "any /api2/json/<anything>" to only the PVE
  // resource families Nexus actually consumes. Defense in depth: even if a
  // future routing bug threads a crafted path past the segment validator,
  // it cannot reach non-allowlisted PVE trees.
  if (path.length === 0 || !ALLOWED_TOP_LEVEL.has(path[0])) {
    return hardenedJson(
      { error: 'Resource not proxied' },
      { status: 403 },
    );
  }
  const pathStr = path.join('/');

  // Preserve query string.
  const url = new URL(req.url);
  const targetUrl = `${PVE_BASE}/${pathStr}${url.search}`;

  // ── Content-Type allow-list (M4) ─────────────────────────────────────────
  const rawContentType = req.headers.get('content-type');
  let forwardedContentType: string | null = null;
  if (rawContentType) {
    // Strip parameters: "application/json; charset=utf-8" → "application/json"
    const mime = rawContentType.split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(mime)) {
      return hardenedJson(
        { error: `Unsupported Content-Type: ${mime}` },
        { status: 415 },
      );
    }
    forwardedContentType = rawContentType;
  }

  const headers: Record<string, string> = {
    Cookie: `PVEAuthCookie=${session.ticket}`,
    CSRFPreventionToken: session.csrfToken,
  };
  if (forwardedContentType) headers['Content-Type'] = forwardedContentType;

  // ── Body size cap (M5) ───────────────────────────────────────────────────
  // Narrowed to `string` — req.text() produces that shape. Avoids the
  // global `BodyInit` vs undici's `BodyInit` type mismatch.
  let body: string | undefined;
  const method = req.method;

  if (method !== 'GET' && method !== 'HEAD') {
    // Cheap pre-read guard: if Content-Length is present and exceeds cap,
    // 413 before buffering anything.
    const lenHeader = req.headers.get('content-length');
    if (lenHeader) {
      const len = Number(lenHeader);
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
        return hardenedJson(
          { error: `Request body too large (${len} > ${MAX_BODY_BYTES} bytes)` },
          { status: 413 },
        );
      }
    }
    body = await req.text();
    // Chunked/no-length clients bypass the Content-Length guard, so re-check
    // after full buffering.
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      return hardenedJson(
        { error: `Request body too large (> ${MAX_BODY_BYTES} bytes)` },
        { status: 413 },
      );
    }
  }

  try {
    const pveRes = await pveFetch(targetUrl, { method, headers, body });

    // 401 path is rare and the body is always small (PVE's "No ticket"
    // text is ~16 bytes; privilege errors are small JSON). Read it
    // eagerly so we can decide whether to clear our session cookies (H10).
    if (pveRes.status === 401) {
      const text = await pveRes.text();
      const response = new NextResponse(text, {
        status: 401,
        headers: {
          'Content-Type': pveRes.headers.get('Content-Type') ?? 'application/json',
          'Cache-Control': 'no-store, private',
        },
      });
      if (isTicketExpiryBody(pveRes.headers.get('Content-Type'), text)) {
        response.cookies.set('nexus_session', '', { httpOnly: true, maxAge: 0, path: '/' });
        response.cookies.set('nexus_csrf', '', { httpOnly: false, maxAge: 0, path: '/' });
      }
      return response;
    }

    // Forward the raw bytes — arrayBuffer() preserves binary payloads
    // (VNC tickets, raw task-log bytes, vzdump manifests) that .text()
    // would have UTF-8-mangled into U+FFFD (H8).
    const buf = Buffer.from(await pveRes.arrayBuffer());
    return new NextResponse(buf, {
      status: pveRes.status,
      headers: {
        'Content-Type': pveRes.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (err) {
    console.error('[Proxmox Proxy Error]', err);
    return hardenedJson(
      { error: 'Failed to reach Proxmox API', detail: String(err) },
      { status: 502 },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;

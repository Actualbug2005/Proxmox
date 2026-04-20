/**
 * Security response headers for every Nexus HTTP response (spec §2.2).
 *
 * Called from the custom HTTP server's `createServer` callback — the single
 * choke-point where static assets, /_next/*, API routes, and Next route
 * handlers all converge. Next middleware would miss static assets under this
 * architecture.
 *
 * Strict nonce-based CSP is a Tier 8 follow-up (needs Next 16 RSC nonce
 * plumbing); current directives allow Tailwind v4 + RSC inline hydration and
 * the noVNC/xterm websocket relay.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

/** True when the request reached us over TLS, directly or via an ingress
 *  that set X-Forwarded-Proto. Controls HSTS emission so plain-HTTP dev
 *  traffic doesn't get the header cached by the browser. */
function isSecure(req: IncomingMessage): boolean {
  const socket = req.socket as unknown as { encrypted?: boolean };
  return (
    (socket && socket.encrypted === true) ||
    req.headers['x-forwarded-proto'] === 'https'
  );
}

export function applySecurityHeaders(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (isSecure(req)) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=15552000; includeSubDomains',
    );
    // Any inline asset URL that slipped in as `http://` will be transparently
    // upgraded rather than fail-closed when Nexus sits behind a TLS ingress.
    res.setHeader('Content-Security-Policy', `${CSP}; upgrade-insecure-requests`);
  }
}

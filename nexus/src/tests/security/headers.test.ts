/**
 * Security response headers. The helper is pure — call setHeader on res —
 * so we exercise it with mock req/res objects, not a real HTTP server.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applySecurityHeaders } from '../../lib/security-headers.ts';

interface MockRes {
  headers: Record<string, string>;
  setHeader: (name: string, value: string) => void;
}

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

interface MockReqInit {
  encrypted?: boolean;
  forwardedProto?: string;
}

function makeReq(init: MockReqInit = {}): {
  socket: { encrypted?: boolean };
  headers: Record<string, string | undefined>;
} {
  return {
    socket: { encrypted: init.encrypted },
    headers: init.forwardedProto
      ? { 'x-forwarded-proto': init.forwardedProto }
      : {},
  };
}

describe('applySecurityHeaders', () => {
  it('sets CSP on every request (plain HTTP)', () => {
    const req = makeReq();
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    assert.ok(res.headers['Content-Security-Policy'], 'CSP header missing');
  });

  it('sets X-Content-Type-Options: nosniff', () => {
    const req = makeReq();
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
    const req = makeReq();
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    assert.equal(
      res.headers['Referrer-Policy'],
      'strict-origin-when-cross-origin',
    );
  });

  it('sets X-Frame-Options: SAMEORIGIN', () => {
    const req = makeReq();
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN');
  });

  it('sets HSTS when req.socket.encrypted === true', () => {
    const req = makeReq({ encrypted: true });
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    const hsts = res.headers['Strict-Transport-Security'];
    assert.ok(hsts, 'HSTS header missing on TLS connection');
    assert.match(hsts!, /max-age=\d+/);
    assert.match(hsts!, /includeSubDomains/);
  });

  it('sets HSTS when X-Forwarded-Proto is https', () => {
    const req = makeReq({ forwardedProto: 'https' });
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    assert.ok(
      res.headers['Strict-Transport-Security'],
      'HSTS header missing for X-Forwarded-Proto: https',
    );
  });

  it('does NOT set HSTS on plain HTTP (no TLS, no xf-proto)', () => {
    const req = makeReq();
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    assert.equal(
      res.headers['Strict-Transport-Security'],
      undefined,
      'HSTS must be absent on plain-HTTP dev traffic',
    );
  });

  it('CSP connect-src allows ws: and wss: (noVNC + xterm)', () => {
    const req = makeReq();
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    const csp = res.headers['Content-Security-Policy']!;
    // Extract the connect-src directive.
    const match = csp.match(/connect-src([^;]*)/);
    assert.ok(match, 'connect-src directive missing');
    const connectSrc = match![1];
    assert.match(connectSrc, /\bws:/, 'connect-src missing ws:');
    assert.match(connectSrc, /\bwss:/, 'connect-src missing wss:');
  });

  it("CSP includes frame-ancestors 'self'", () => {
    const req = makeReq();
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySecurityHeaders(req as any, res as any);
    const csp = res.headers['Content-Security-Policy']!;
    assert.match(csp, /frame-ancestors 'self'/);
  });
});

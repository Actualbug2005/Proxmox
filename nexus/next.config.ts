import type { NextConfig } from "next";

// Security headers shipped by the app itself — belt-and-braces that applies
// regardless of the ingress (Cloudflare Access, Tailscale, Caddy, nothing).
// Tuned for Nexus's dependencies:
//   - xterm.js + recharts need 'unsafe-eval' + 'unsafe-inline' under CSP
//   - /api/console/* opens a WebSocket for the VNC/xterm relay → wss: allowed
//   - frame-ancestors 'none' hard-blocks clickjacking
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "geolocation=(), microphone=(), camera=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // Script logos come from two fixed upstream CDNs — selfhst icons on
      // jsDelivr (used for nearly every community-script entry) and the
      // raw.githubusercontent fallback (used for scripts that ship a logo
      // inside the ProxmoxVE repo itself). Both are allow-listed by host
      // rather than opening img-src to all of https: so a future injection
      // can't pull a tracking pixel from an arbitrary origin.
      "img-src 'self' data: blob: https://cdn.jsdelivr.net https://raw.githubusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' wss: https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
    ];
  },
};

export default nextConfig;

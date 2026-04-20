# Configuration

Nexus reads its configuration from `/opt/nexus/.env.local` (created by the installer) and persists it across upgrades. Every var below is optional except where marked **required**.

## Environment variables

| Variable | Required | Default | When to set | Example |
| --- | --- | --- | --- | --- |
| `PROXMOX_HOST` | **yes** | `localhost` | Always. Set to the LAN IP of the PVE host if Nexus runs outside the host (e.g. in an LXC). | `192.0.2.10` |
| `JWT_SECRET` | **yes** | auto-generated | Only if you're moving the install and want to preserve sessions across the move. | `$(openssl rand -base64 36)` |
| `PORT` | no | `3000` | When port 3000 is already in use, or you want to front Nexus with a reverse proxy on a different port. | `8080` |
| `REDIS_URL` | no | _(in-memory)_ | To run multiple Nexus instances behind a load balancer, or to survive restarts without losing sessions. | `redis://127.0.0.1:6379` |
| `NEXUS_SECURE_COOKIES` | no | `true` in prod, `false` in dev | Set `false` when serving over plain HTTP on a trusted LAN (otherwise browsers refuse the session cookie). | `false` |
| `NEXUS_DATA_DIR` | no | `$TMPDIR/nexus-data` | **Production:** override to a durable path. The default lives under `/tmp` and is wiped on reboot. | `/var/lib/nexus` |
| `NEXUS_VERSION_FILE` | no | `/opt/nexus/current/VERSION` | Rarely set — the release tarball bakes the version in. Override only for custom deployments. | `/etc/nexus/VERSION` |
| `NEXUS_REPO` | no | `Actualbug2005/Proxmox` | If you fork Nexus and want the "new release available" probe to check your fork instead. | `myuser/my-fork` |

After editing `.env.local`, restart the service:

```bash
systemctl restart nexus
```

## Redis (optional)

Without Redis, sessions live in-memory and reset whenever the process restarts — fine for a single-user home setup, not fine for HA or for surviving crashes.

Any reachable Redis works. Examples:

```bash
REDIS_URL=redis://127.0.0.1:6379              # local, no auth
REDIS_URL=redis://:s3cret@redis.internal:6379 # remote, password auth
REDIS_URL=redis://:s3cret@redis.internal:6379/2  # use DB index 2
```

Nexus uses `ioredis` under the hood with automatic reconnection; a Redis outage degrades session lookup but does not crash the app.

## TLS / self-signed certificates

PVE ships with a self-signed cert on port 8006. Earlier Nexus releases set `NODE_TLS_REJECT_UNAUTHORIZED=0` process-wide, which disabled cert validation for **every** outbound call.

As of v0.24, Nexus scopes the TLS bypass to a dedicated `undici.Agent` used only by `pveFetch`. Everything else — GitHub API calls for release checks, SMTP for notifications, Community Scripts catalogue fetches — validates certs normally.

**You do not need to set `NODE_TLS_REJECT_UNAUTHORIZED`.** If you see it in your environment, remove it.

## Data directory

The persistent data directory holds:

- `scheduled-jobs.json` — one-shot and recurring script jobs
- `scheduled-chains.json` — [script chains](Script-Chains) and their state (including the `consecutiveFailures` counter that triggers auto-disable)
- `service-account.json` — encrypted PVE API token for the local cluster's background tickers (DRS, guest-agent probes, notifications)
- `federation.json` — encrypted list of registered remote PVE clusters (v0.34.0+). Mode `0600`, AES-256-GCM, key derived from `JWT_SECRET`. See [Federation](Federation) for details.

On a fresh install, `NEXUS_DATA_DIR` defaults to `$TMPDIR/nexus-data` — **`/tmp` on most Linuxes, wiped on reboot**. For any real deployment, override it:

```bash
# /opt/nexus/.env.local
NEXUS_DATA_DIR=/var/lib/nexus
```

Create the directory and give the service user write access:

```bash
mkdir -p /var/lib/nexus
chown root:root /var/lib/nexus   # systemd runs Nexus as root by default
```

## Cookies over plain HTTP

In production, Nexus sets the session cookie with the `Secure` attribute, which browsers refuse over plain HTTP. If you run Nexus behind a reverse proxy that terminates TLS, you're fine — Nexus sees HTTPS at the request boundary.

If you access Nexus directly over `http://<ip>:3000` on your LAN, disable the `Secure` flag:

```bash
NEXUS_SECURE_COOKIES=false
```

Only do this on a trusted network. Any man-in-the-middle on the path can steal the session cookie.

## Changing the port

Three places to update when moving off 3000:

1. `.env.local`: `PORT=8080`
2. PVE host firewall: open the new port, close the old one.
3. Any reverse-proxy config (nginx, Caddy, Cloudflare Tunnel) pointing at Nexus.

Restart with `systemctl restart nexus` and check `ss -lnt | grep 8080` to confirm.

## Security headers

As of **v0.33.0**, Nexus emits a conservative set of security response headers on every route (Next pages, API, static assets) via a single choke-point in the custom HTTP server. There is nothing to configure — the defaults are safe for both plain-HTTP LAN use and public ingress behind TLS.

Header footprint:

| Header | Value | Notes |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` | `unsafe-inline`/`unsafe-eval` are required by Next 16 RSC + Tailwind v4. Nonce-based tightening is planned for Tier 8. `ws:`/`wss:` covers noVNC + xterm. |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | **Only emitted over TLS** (direct TLS socket or `X-Forwarded-Proto: https`). Plain-HTTP dev traffic never gets this header, so a `localhost` test won't brick your browser. 180 days — reasonable for a non-preload-list tool. |
| `Content-Security-Policy` (TLS) | `… ; upgrade-insecure-requests` | Appended under the same TLS condition as HSTS. Inline `http://` asset URLs are upgraded rather than failing closed. |
| `X-Content-Type-Options` | `nosniff` | Stops MIME-sniffing attacks on user-uploaded ISO/content. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Doesn't leak node/VM paths to third-party sites. |
| `X-Frame-Options` | `SAMEORIGIN` | Legacy belt-and-braces alongside `frame-ancestors 'self'`. |

### Proxy allowlist

The catch-all `/api/proxmox/[...path]` proxy only forwards requests to six top-level PVE resource families: `cluster`, `nodes`, `storage`, `access`, `pools`, `version`. Anything else returns `403 {"error":"Resource not proxied"}`. If you integrate a custom PVE endpoint outside those families, extend `ALLOWED_TOP_LEVEL` in `src/app/api/proxmox/[...path]/route.ts` — it's a conscious widening rather than incidental scope creep.

### Reverse-proxy checklist

If you front Nexus with nginx/Caddy/Cloudflare, make sure the proxy sets `X-Forwarded-Proto: https` on TLS-terminated connections. That's the signal Nexus uses to gate HSTS emission.

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
}
```

Without the header, browsers over your TLS ingress won't receive HSTS and the upgrade-insecure-requests CSP directive won't fire. No actual security is lost — you're just missing two defence layers.

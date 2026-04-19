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

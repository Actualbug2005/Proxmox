# Nexus deployment templates

Pick the stack that matches your homelab. Every template here assumes Nexus
itself is built from `../nexus/` and running on `:3000` behind a reverse
proxy — the proxy terminates TLS and injects the Phase-2 hardening headers.

## Deployment matrix

| Stack | TLS termination | ZTNA / MFA | L3/L4 dropping | Config dir |
|---|---|---|---|---|
| **Caddy + Cloudflare Tunnel** | Cloudflare edge | Cloudflare Access | CrowdSec | [`caddy/`](./caddy) |
| **nginx + Tailscale** | nginx + LE cert | Tailscale ACL + WebAuthn | CrowdSec | [`nginx/`](./nginx) |
| **Traefik + Authelia** | Traefik + LE cert | Authelia (forward-auth MFA) | CrowdSec | [`traefik/`](./traefik) |
| **CrowdSec bouncers** | N/A | N/A | iptables/nftables + proxy bouncer | [`crowdsec/`](./crowdsec) |

Each stack includes:
- All Phase-2 security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- Network-layer ZTNA gating before any request reaches Nexus.
- Hooks for CrowdSec's blocklist (IP dropping).
- Body-size caps, per-route rate limits, and WebSocket-aware config for the xterm relay.

## Trust model (what the ingress provides vs what Nexus provides)

| Control | Primary (infrastructure) | Fallback (Nexus app) |
|---|---|---|
| TLS | Ingress terminates | — |
| HSTS / CSP / frame-ancestors | Ingress emits | — |
| Identity / MFA | ZTNA (Cloudflare Access / Tailscale / Authelia) | — (Nexus trusts the edge) |
| Brute-force blocking | CrowdSec @ L3 | App-level rate limiter (10/5min) |
| Path traversal | — | Nexus validates segments |
| Body size cap | Ingress caps at 12 MB / 20 GB (ISO) | App caps at 10 MB |
| Content-Type allow-list | — | Nexus enforces |
| Cache-Control no-store | — | Nexus sets |
| PVE ticket refresh | — | Nexus refreshes at 90 min |

The left column is the "ideal" infrastructure-owned path. The right column
is the belt-and-braces fallback the app ships with today — so Nexus is safe
even on day one before the ingress is deployed.

## Ordering of deployment

1. **Bring up Nexus itself**, either via `install.sh` or the compose file
   in [`traefik/docker-compose.yml`](./traefik/docker-compose.yml). Confirm
   it answers on `localhost:3000` over HTTP.
2. **Generate the audit keypair** (Phase 1 C2). Off-box:
   ```bash
   openssl genrsa -out audit-private.pem 4096
   openssl rsa -in audit-private.pem -pubout -out audit-pubkey.pem
   scp audit-pubkey.pem nexus-host:/etc/nexus/audit-pubkey.pem
   ```
3. **Put the chosen reverse proxy in front**. Copy the relevant config from
   this directory, edit domain names + cert paths, reload the proxy.
4. **Attach ZTNA** (Cloudflare Access policy / Tailscale ACL / Authelia user
   database).
5. **Install CrowdSec + bouncer** ([`crowdsec/bouncers/README.md`](./crowdsec/bouncers/README.md)),
   deploy the parser and scenarios, verify with a dry-run bad login.
6. **Flip Nexus to production mode**: set `NODE_ENV=production` in
   `.env.local`. This auto-enables `secure: true` on cookies (the
   `X-Forwarded-Proto: https` header from the reverse proxy validates it).
7. **Disable direct `:3000` exposure** at the firewall — the reverse proxy
   is now the only path in.

## Verification checklist

After deployment, this should all be true:

- `curl -I https://nexus.example/` returns `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`.
- A failed login emits a JSON event to CrowdSec within 1s (`journalctl -u nexus -f`).
- 10 rapid failed logins trigger a ban visible in `cscli decisions list`.
- Attempting to access `/dashboard/` without a valid ZTNA session is intercepted by the ingress, never reaching Nexus.
- PVE ticket refresh triggers silently at 90 min: watch `journalctl -u nexus` for a `refreshPVESessionIfStale` log around that mark.
- `curl https://nexus.example/api/proxmox/..%2F..%2Fetc` returns 400 (path-segment validation).
- `curl -X POST https://nexus.example/api/proxmox/foo -H 'content-type: application/zip' -d ...` returns 415.

## Threat model reference

See [`../docs/SECURITY.md`](../docs/SECURITY.md) for the full threat model
and what each finding in the original security audit is mitigated by.

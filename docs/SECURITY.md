# Nexus security — threat model + operator trust boundaries

Nexus proxies root-equivalent Proxmox VE credentials. This document
describes the attacker model it defends against, the split of
responsibility between the app and the ingress infrastructure, and the
current state of each audit finding.

If you're deploying Nexus, read the **Operator responsibilities** and
**Secrets that must live off the running host** sections first.

> **Quick path:** on a fresh install, run
> [`./deploy/install-hardening.sh`](../deploy/install-hardening.sh) once —
> it sets up CrowdSec + Caddy + self-signed HTTPS + audit keypair in one
> shot. Then [`./deploy/nexus-doctor.sh`](../deploy/nexus-doctor.sh) gives
> you a health report any time. The sections below explain what each layer
> does and how to tune it; the installer makes the defaults work.

---

## Attacker model

Nexus is an overlay UI for Proxmox VE. An attacker who compromises it
gains:

- **Root on every cluster node** (via `/api/exec` + the PVE Sys.Modify ACL).
- **Full VM/CT lifecycle control** (start, stop, destroy, clone, snapshot).
- **Disk-image read/write** via ISO upload + storage browse endpoints.
- **Network identity** of the PVE host (LAN-attacker vantage point).

The threat model therefore assumes a **motivated adversary with network
reach** (LAN, compromised WiFi, or shared CGNAT), not just opportunistic
scan traffic. Mitigations are layered so no single failure (cert bug,
ingress misconfig, app regression) grants RCE.

### In scope

- LAN sniffers lifting cookies / PVE tickets / login credentials.
- Brute-force and credential-stuffing against the login endpoint.
- SSRF probing via the proxy or login flows.
- Command injection into `/api/exec` or `/api/scripts/run`.
- Path traversal via NAS browse/download endpoints.
- XSS / CSRF against logged-in users.
- Session hijacking via stolen cookies.
- TLS MITM against outbound PVE calls.
- Cross-site invocation of mutating endpoints.

### Out of scope

- **Physical access to the PVE host.** If the attacker can ssh in as root
  or read `/etc/pve/`, Nexus is already irrelevant — PVE itself is owned.
- **Compromise of the PVE cluster's corosync private network.**
- **A malicious PVE user with legitimate Sys.Modify** already has
  root-equivalent on the target node. Nexus's audit log records them;
  Nexus does not attempt to restrict what they can do beyond what PVE
  itself restricts.
- **A malicious operator decrypting the audit log off-box.** The asymmetric
  hybrid audit log protects the command contents from everyone *except*
  the holder of the private key. Whoever holds that key is trusted.

---

## Trust boundaries

Three layers own different parts of the stack. Each is independently
deployable; the app has fallbacks for everything the ingress should own,
so day-zero deployments without the full ingress are still safe.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cloudflare Edge  /  Tailscale Tailnet  /  Authelia forward-auth    │
│  — ZTNA gatekeeper: who can reach the server at all                 │
│  — MFA enforcement, identity binding                                │
│  — Default-deny for everything non-admin                            │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Reverse proxy: Caddy / nginx / Traefik                             │
│  — TLS termination (Let's Encrypt / Cloudflare origin cert)         │
│  — HSTS, CSP, frame-ancestors, X-Content-Type-Options, …            │
│  — Body size caps (12 MB general, 20 GB ISO)                        │
│  — Rate limit (30/s general, 2/s login — coarse edge controls)      │
│  — X-Forwarded-Proto=https → triggers Nexus's secure-cookie mode    │
│                                                                      │
│  CrowdSec bouncer (at this layer OR at nftables)                    │
│  — L3/L4 drop of IPs that tripped local/community scenarios         │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Nexus (Next.js 16 + Node 22)                                       │
│  — Session management: opaque 256-bit sessionId → Redis/memory      │
│  — CSRF double-submit HMAC (validateCsrf on every mutating route)   │
│  — PVE ticket refresh at 90 min                                     │
│  — Scoped TLS bypass for PVE only (undici Agent, pveFetch)          │
│  — Path-segment validation, body size cap, Content-Type allow-list  │
│  — Per-session rate limits + concurrency semaphores                 │
│  — Structured login logs → CrowdSec parser                          │
│  — Asymmetric hybrid audit log for /api/exec + /api/scripts/run     │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Proxmox VE pveproxy (:8006)  —  self-signed cert                   │
│  — Ticket issuance + CSRF enforcement                               │
│  — ACL evaluation (Sys.Modify, Sys.Audit, etc.)                     │
│  — Actual VM / storage / network operations                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Control ownership matrix

| Concern | Ingress (primary) | Nexus (fallback) | PVE (floor) |
|---|---|---|---|
| TLS cert + protocol | ✓ | — | — |
| HSTS, CSP, X-Frame-Options | ✓ | — | — |
| Identity (who is this user?) | ✓ (ZTNA + MFA) | ✓ (PVE creds → ticket) | ✓ (PAM/PVE realm) |
| Brute-force blocking | ✓ (CrowdSec L3 + ingress RL) | ✓ (10/5min per IP+user) | ✓ (PVE's own 1s delay) |
| Session revocation | — (ingress session) | ✓ (store DELETE) | — |
| Body size caps | ✓ (outer 12 MB) | ✓ (inner 10 MB) | — |
| Path traversal | — | ✓ (segment validation) | — |
| Content-Type allow-list | — | ✓ | — |
| Cache-Control no-store | — | ✓ | — |
| Command injection in exec | — | ✓ (argv isolation + stdin) | — |
| PVE ACL enforcement | — | — | ✓ (Sys.Modify checked) |
| Cert pinning (PVE hop) | — | ⚠ (skipped; scoped Agent) | — |
| Audit log (exec, run) | — | ✓ (asymmetric hybrid) | — (not bypassable) |

Every row with two ✓s is belt-and-braces. Every row where only Nexus
appears is app-level only — that's where the ingress can't help (the
concern is specific to Nexus's business logic).

---

## Operator responsibilities

Nexus ships with sensible defaults but several controls require operator
decisions the application can't make for you.

### 1. Deploy the ingress

Pick one from [`deploy/`](../deploy/) and stand it up *before* setting
`NODE_ENV=production`. The app is safe in dev mode (no Secure cookies,
no ZTNA) on localhost; it's not safe on a LAN without the ingress.

### 2. Generate the audit keypair off-box

The asymmetric hybrid audit log encrypts `/api/exec` and
`/api/scripts/run` command payloads with a public key the app reads
from `/etc/nexus/audit-pubkey.pem`. The matching **private key must
never touch the running system** — otherwise an attacker who owns the
Nexus process can decrypt everything.

```bash
# Run this on a separate machine (laptop, offline USB, yubikey PIV host).
openssl genrsa -out audit-private.pem 4096
openssl rsa  -in audit-private.pem -pubout -out audit-pubkey.pem

# Deploy ONLY the public half:
scp audit-pubkey.pem nexus-host:/etc/nexus/audit-pubkey.pem

# Store audit-private.pem in a password manager / yubikey / offline USB.
# NEVER put it on the PVE host.
```

Read the encrypted log off-box with
[`scripts/nexus-audit-decrypt.ts`](../nexus/scripts/nexus-audit-decrypt.ts):

```bash
node --experimental-strip-types scripts/nexus-audit-decrypt.ts \
     --key ~/keys/audit-private.pem \
     --entry-id 01HM0Z... \
     /var/log/nexus/exec-commands.enc.jsonl
```

### 3. Set up the CrowdSec pipeline

Copy [`deploy/crowdsec/parsers/s01-parse/nexus-login.yaml`](../deploy/crowdsec/parsers/s01-parse/nexus-login.yaml)
and [`deploy/crowdsec/scenarios/nexus-bf.yaml`](../deploy/crowdsec/scenarios/nexus-bf.yaml)
to `/etc/crowdsec/{parsers,scenarios}/`, configure log acquisition per
[`deploy/crowdsec/acquis.yaml`](../deploy/crowdsec/acquis.yaml), install
a bouncer per
[`deploy/crowdsec/bouncers/README.md`](../deploy/crowdsec/bouncers/README.md).

Add your tailnet + LAN ranges to the allowlist so failed logins from
you don't self-ban:

```bash
sudo cscli allowlists items add --ip 100.64.0.0/10   # Tailscale CGNAT
sudo cscli allowlists items add --ip 10.0.0.0/8       # LAN
```

### 4. Rotate keys annually

- **Audit keypair**: annually. Old ciphertext stays decryptable with the
  old private key, so rotation doesn't lose history.
- **`JWT_SECRET`** in `.env.local`: rotate only on a breach scare — rotation
  invalidates every active session (CSRF tokens are HMAC'd against it).

### 5. Monitor

At minimum:

- `journalctl -u nexus -f` — watch for `component=nexus` events during
  normal operation. `outcome=success` should dominate; `outcome=fail`
  bursts mean something.
- `cscli decisions list` — any active bans → review the source IP.
- `/var/log/nexus/exec.jsonl` — periodic grep for unexpected exec calls.

---

## Secrets that must live off the running host

| Secret | Where it lives | Where it must NOT be |
|---|---|---|
| `JWT_SECRET` | `.env.local` on the Nexus host | git repo, logs, public docs |
| PVE root password | Nothing stores it; ticket-only flow | anywhere except the admin's own password manager |
| PVE ticket (`PVEAuthCookie`) | Server-side session store only | browser cookies, any log, response body |
| PVE CSRF prevention token | Server-side session store only | browser JS, any log |
| Nexus `nexus_session` cookie | Browser (httpOnly, Secure in prod) | any log |
| Nexus `nexus_csrf` cookie | Browser (non-httpOnly by design, SameSite=Strict) | response bodies (it's already in a cookie) |
| **Audit private key** | Offline machine, yubikey PIV, password manager | the running PVE host, any server |
| Audit public key | `/etc/nexus/audit-pubkey.pem` | git is fine — public key is public |
| Authelia / Cloudflare Access secrets | Per ingress stack's own secret store | the Nexus process |

---

## Current finding status

From the audit performed in this branch. A ✓ means fully closed; ◐ means
mitigated via infrastructure (requires deployment from
[`deploy/`](../deploy/)); – means not addressed yet.

### Critical

| # | Finding | Status | Where |
|---|---|---|---|
| C1 | Global `NODE_TLS_REJECT_UNAUTHORIZED='0'` | ✓ | [`src/lib/pve-fetch.ts`](../nexus/src/lib/pve-fetch.ts), commit `2014cc4` |
| C2 | `/api/exec` has no caps / audit / rate limit | ✓ | [`src/lib/exec-{policy,audit}.ts`](../nexus/src/lib/), commit `58c4ea1` |
| C3 | curl redirect-follow can escape URL whitelist | ✓ | [`src/app/api/scripts/run/route.ts`](../nexus/src/app/api/scripts/run/route.ts), commit `42c78d2` |

### High

| # | Finding | Status | Where |
|---|---|---|---|
| H1 | Cookies hardcoded `secure: false` | ✓ (prod) | [`src/lib/auth.ts`](../nexus/src/lib/auth.ts), commit `90bdd06` |
| H2 | No login rate limit | ✓ | App (per-IP+user) + CrowdSec L3 + ingress |
| H3 | Login error passthrough + SSRF-lite via host | ✓ | Host field removed; generic errors; commit `90bdd06` |
| H4 | Proxy path segments not validated | ✓ | `invalidSegment()` in `proxmox/[...path]/route.ts` |
| H5 | WS ticket ACL + session rebind | – | Phase 3 |
| H6 | Zero security headers | ◐ | [`deploy/*/`](../deploy) ingress configs; must deploy to enforce |
| H7 | TOFU ssh host-key acceptance | – | Phase 3 (needs operator runbook for known_hosts seeding) |
| H8 | `/api/scripts/run` no timeout / AbortSignal | – | Phase 3 |
| H9 | No concurrency cap on run/exec | ✓ | `RATE_LIMITS.{exec,scriptsRun}.maxConcurrent`, commit `58c4ea1` |
| H10 | Local-exec pipeline duplicated | – | Phase 3 |
| H11 | `userHasPrivilege` fails open on transport err | ✓ | try/catch in [`permissions.ts`](../nexus/src/lib/permissions.ts), commit `2014cc4` |

### Medium (sampled — full list in commit messages)

| # | Finding | Status |
|---|---|---|
| M1 | Session / PVE ticket TTL mismatch | ✓ Proactive refresh at 90 min, commit `b17920c` |
| M4 | `Content-Type` echoed without allow-list | ✓ commit `90bdd06` |
| M5 | No body size cap on proxy | ✓ 10 MB, commit `90bdd06` |
| M6 | No `Cache-Control: no-store` on responses | ✓ commit `90bdd06` |

### Deferred to Phase 3

- H5 (WS ticket ACL + session rebind on upgrade)
- H7 (SSH `known_hosts` pinning, `StrictHostKeyChecking=yes`)
- H8 (run-route timeout + AbortSignal — move through `runViaStdin`)
- H10 (unify local + ssh exec pipelines)
- M2, M10, M11, M12 (session rotation, ISO upload hardening, slug regex, NUL in path guards)

---

## Reporting a vulnerability

For a homelab project, email the repo owner or open a private GitHub
Security Advisory. Do not open a public issue until the finding is
triaged and a fix plan exists.

---

## Change history

| Phase | Commits | Date |
|---|---|---|
| 1 (critical fixes) | `2014cc4` `42c78d2` `58c4ea1` `b17920c` | 2025-04-16 |
| 2 app (belt-and-braces) | `90bdd06` | 2025-04-16 |
| 2 infra (ingress templates) | `574dc0f` | 2025-04-16 |
| 2 docs (this file) | — | 2025-04-16 |

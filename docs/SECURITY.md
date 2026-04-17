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

Three layers own different parts of the stack, but the middle layer is
**optional**. Nexus ships security headers, body caps, path validation,
rate limiting and audit logging at the app layer, so a deployment with
only an edge ZTNA (Cloudflare Access, Tailscale Funnel) and no reverse
proxy is still safe. A reverse proxy adds defence-in-depth when you have
it; it's not a prerequisite.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Edge / ZTNA  —  Cloudflare Access, Tailscale, Authelia             │
│  — ZTNA gatekeeper: who can reach the server at all                 │
│  — TLS termination with a public-trusted cert (CF / LE / Funnel)    │
│  — MFA enforcement, identity binding                                │
│  — Default-deny for everything non-admin                            │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Reverse proxy (OPTIONAL): Caddy / nginx / Traefik                  │
│  — Only needed for direct-LAN deployments. Skippable when Cloudflare│
│    Tunnel, Tailscale Funnel, etc. already terminate edge TLS.       │
│  — TLS termination (Let's Encrypt via Cloudflare DNS / self-signed) │
│  — Belt-and-braces body caps, rate limits                           │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Nexus (Next.js 16 + Node 22)                                       │
│  — HSTS, CSP, X-Frame-Options, X-Content-Type-Options,              │
│    Referrer-Policy, Permissions-Policy via next.config.ts           │
│  — Loopback bind (HOSTNAME=127.0.0.1) — no LAN bypass of ingress    │
│  — Session management: opaque 256-bit sessionId → Redis/memory      │
│  — CSRF double-submit HMAC (validateCsrf on every mutating route)   │
│  — PVE ticket refresh at 90 min                                     │
│  — Scoped TLS bypass for PVE only (undici Agent, pveFetch)          │
│  — Path-segment validation, body size cap, Content-Type allow-list  │
│  — Per-session rate limits + concurrency semaphores                 │
│  — Structured login logs → CrowdSec parser                          │
│  — Asymmetric hybrid audit log for /api/exec + /api/scripts/run     │
└─────────────────────────────────────────────────────────────────────┘
                                 │  ↑ CrowdSec nftables bouncer
                                 │    reads scenarios triggered by the
                                 │    login logs above, drops IPs at L3
                                 ▼
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

| Concern | Edge / ZTNA | Reverse proxy (opt.) | Nexus (app) | PVE (floor) |
|---|---|---|---|---|
| TLS cert + protocol | ✓ (public-trusted) | ✓ (if deployed) | — | — |
| HSTS, CSP, X-Frame-Options | — | ✓ (if deployed) | ✓ (next.config.ts) | — |
| Identity (who is this user?) | ✓ (ZTNA + MFA) | — | ✓ (PVE creds → ticket) | ✓ (PAM/PVE realm) |
| Brute-force blocking | ✓ (edge RL) | — | ✓ (10/5min per IP+user) | ✓ (PVE's own 1s delay) |
| L3/L4 IP dropping | — | — | ✓ (CrowdSec nft bouncer reads Nexus logs) | — |
| Session revocation | — (edge session) | — | ✓ (store DELETE) | — |
| Body size caps | ✓ (edge) | ✓ (if deployed) | ✓ (inner 10 MB) | — |
| Loopback-only bind | — | — | ✓ (HOSTNAME=127.0.0.1) | — |
| Path traversal | — | — | ✓ (segment validation) | — |
| Content-Type allow-list | — | — | ✓ | — |
| Cache-Control no-store | — | — | ✓ | — |
| Command injection in exec | — | — | ✓ (argv isolation + stdin) | — |
| PVE ACL enforcement | — | — | — | ✓ (Sys.Modify checked) |
| Cert pinning (PVE hop) | — | — | ⚠ (skipped; scoped Agent) | — |
| Audit log (exec, run) | — | — | ✓ (asymmetric hybrid) | — (not bypassable) |

Every row with two ✓s is belt-and-braces. Every row where only Nexus
appears is app-level only — that's where the ingress can't help (the
concern is specific to Nexus's business logic).

---

## Operator responsibilities

Nexus ships with sensible defaults but several controls require operator
decisions the application can't make for you.

### 1. Pick an ingress topology

Nexus binds to loopback in production (`HOSTNAME=127.0.0.1`), so *something*
has to front it. Pick one:

- **Cloudflare Access / Tailscale Funnel / Authelia** — edge terminates TLS
  with a public-trusted cert, handles ZTNA + MFA, tunnels to loopback. No
  local reverse proxy needed. This is the simplest path.
- **Caddy on :443** — direct-LAN deployments. Run
  [`./deploy/install-hardening.sh`](../deploy/install-hardening.sh) and pick
  option 2 (Let's Encrypt via Cloudflare DNS-01) or option 3 (self-signed).
- **Nothing** — only acceptable on an offline lab network. The app's
  security headers, CSRF, and CrowdSec still protect it, but HSTS is
  meaningless without HTTPS.

`NODE_ENV=production` must be set in the Nexus env file regardless — this
is what flips secure-cookie mode. The installer handles it for you.

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

Run [`./deploy/install-hardening.sh`](../deploy/install-hardening.sh) —
it drops the parser and three scenarios into `/etc/crowdsec/`, wires
log acquisition via journalctl, installs the nftables firewall bouncer,
and auto-allowlists your primary LAN CIDR (from `ip route`) plus loopback.

Manual allowlist tweaks use `cscli` (note the syntax differs by version):

```bash
cscli allowlists add nexus-homelab 100.64.0.0/10   # Tailscale CGNAT
cscli allowlists add nexus-homelab YOUR_ADMIN_IP
```

Scenarios shipped:
- `nexus/login-bf` — 5 fails in ~2.5 min → 5-min ban
- `nexus/login-slowbf` — 10 fails over ~100 min → 1-hr ban
- `nexus/credential-stuffing` — 3 distinct usernames from one IP → 12-hr ban

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
| 2.1 one-shot installer + `nexus doctor` | — | 2026-04-17 |
| 2.2 security headers → `next.config.ts`; Caddy now optional | — | 2026-04-17 |

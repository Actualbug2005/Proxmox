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
- **`GET /api/system/health`** (auth-gated) — surfaces the silent-failure
  counters the audit flagged: `counters.renewalFailures`,
  `counters.permissionProbeErrors`, `counters.auditWriteFailures`,
  `counters.schedulerFireFailures`, plus `session.backend` (flips from
  `redis` → `memory` if the Redis auto-fallback ever fires). Scrape at
  30–60 s and alert on any non-zero delta. Structured log lines with
  stable event names back each counter:
  `event=pve_renewal_failed`, `event=permission_probe_error`,
  `event=exec_audit_write_failed`, `event=scheduler_fire_failed`,
  `event=session_store_fallback`, `event=scheduler_auto_disabled`.

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

## Compile-time guards (app layer)

Two mechanisms catch whole classes of bug before runtime:

### 1. Route middleware (`withAuth` / `withCsrf`)

Every mutating route composes through `withCsrf`; every authenticated
read uses `withAuth`. The handler signature requires `ctx.session`,
so a route that "forgot" the CSRF check doesn't compile. Search the
tree for hand-rolled `getSession() + validateCsrf()` — the only three
routes that legitimately bypass this pattern are `auth/login`,
`auth/logout`, and the multi-verb `proxmox/[...path]` proxy; all
other paths go through the HOFs.

### 2. Branded primitives (`@/types/brands`)

Nominal brands on the values that trust enters through. Each brand has
a single sanctioned parser; any `as Brand` cast without going through
the parser is a review smell.

| Brand | Parser validates | Used on |
|---|---|---|
| `SessionTicket` | non-empty, ≤ 4 KB | `PVEAuthSession.ticket` (raw PVE ticket string) |
| `PveCsrfToken` | non-empty, ≤ 512 B | `PVEAuthSession.csrfToken` (PVE's own CSRF, version-flexible format) |
| `CsrfToken` | 64 lowercase hex | Nexus double-submit cookie (HMAC-SHA-256 of sessionId) |
| `Userid` | `user@realm` shape | `PVEAuthSession.username` |
| `VmId` | int in [1..999_999_999] | VM / CT ids on every per-guest route |
| `NodeName` | same regex as SSH injection guard | node segment of every per-node call |
| `BatchId` | UUID v4 | Bulk-lifecycle batch ids |
| `Slug` | lowercase kebab-case, ≤ 63 chars | Community-Script slug on `/api/scripts/[slug]` |
| `SafeRelPath` | strips leading `/`, forbids `..` segments | NAS browse / download sub-paths |
| `CronExpr` | validated by `lib/cron-match.validateCron` | schedule / chain schedule expressions |

`SessionTicket` / `PveCsrfToken` / `Userid` are re-parsed on every PVE
response (login, ticket renewal) so a behaviour change or MITM can't
sneak a malformed value into the session store — parse failures fall
back to the renewal-failure path (stale session returned, back-off
stamped, failure counter incremented).

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
| H5 | WS ticket ACL + session rebind | ◐ | `/api/proxmox-ws` is now behind `withCsrf` (0.9.1) and PVE's ACL refuses to mint termproxy tickets to callers without the right rights. Nexus-side `requireNode*` re-check and sessionId rotation on upgrade are still Phase 3. |
| H6 | Zero security headers | ✓ | Now set by Nexus itself via [`next.config.ts`](../nexus/next.config.ts) |
| H7 | TOFU ssh host-key acceptance | – | Phase 3 (needs operator runbook for known_hosts seeding) |
| H8 | `/api/scripts/run` no timeout / AbortSignal | ✓ | `AbortController` + SIGTERM→SIGKILL escalation + `curl --max-time` in [`scripts/run/route.ts`](../nexus/src/app/api/scripts/run/route.ts) |
| H9 | No concurrency cap on run/exec | ✓ | `RATE_LIMITS.{exec,scriptsRun}.maxConcurrent`, commit `58c4ea1` |
| H10 | Local-exec pipeline duplicated | ✓ | Unified in [`run-script-job.ts`](../nexus/src/lib/run-script-job.ts) — `const file = isLocal ? 'bash' : 'ssh'` feeds one `spawnDetached` so audit/timeout/abort apply uniformly to both targets. |
| H11 | `userHasPrivilege` fails open on transport err | ✓ | try/catch in [`permissions.ts`](../nexus/src/lib/permissions.ts), commit `2014cc4` |

### Medium (sampled — full list in commit messages)

| # | Finding | Status |
|---|---|---|
| M1 | Session / PVE ticket TTL mismatch | ✓ Proactive refresh at 90 min, commit `b17920c` |
| M2 | Session ID not rotated on login | ✓ `startSession()` deletes the pre-login sessionId from the store before issuing the new cookie |
| M4 | `Content-Type` echoed without allow-list | ✓ commit `90bdd06` |
| M5 | No body size cap on proxy | ✓ 10 MB, commit `90bdd06` |
| M6 | No `Cache-Control: no-store` on responses | ✓ commit `90bdd06` |
| M10 | ISO upload hardening | – | Phase 3 |
| M11 | Script slug regex too permissive | ✓ Tightened to strict lowercase kebab-case, 63-char cap |
| M12 | NUL byte in proxy path segments | ✓ Already covered by the `< 0x20` control-char check in `invalidSegment()` |

### Deferred to Phase 3

- H5 — WS ticket Nexus-side ACL re-check (`requireNodeSysAudit` /
  `requireVmConsole`) and session rebind on upgrade. Partially
  mitigated via `withCsrf` + PVE's own refusal on ticket issuance;
  the operator-side hardening isn't in yet.
- H7 — SSH `known_hosts` pinning + `StrictHostKeyChecking=yes`.
  Current code uses `accept-new` (TOFU). Needs an operator runbook
  for seeding `known_hosts` from `/etc/pve/priv/known_hosts`.
- M10 — ISO upload hardening: MIME check, magic-byte sniff, and
  per-storage size cap in [`api/iso-upload/route.ts`](../nexus/src/app/api/iso-upload/route.ts).

### Closed in Phase 3

- H10 (local-exec pipeline unification) — both local and SSH paths
  now go through a single `spawnDetached` in `run-script-job.ts`,
  so audit log, timeout, and SIGTERM→SIGKILL abort apply uniformly.

---

## Reporting a vulnerability

For a homelab project, email the repo owner or open a private GitHub
Security Advisory. Do not open a public issue until the finding is
triaged and a fix plan exists.

---

## Change history

| Phase | Description | Release | Date |
|---|---|---|---|
| 1 | Critical fixes: global-TLS bypass, exec caps, curl redirect-follow, ticket refresh | — | 2025-04-16 |
| 2 app | Belt-and-braces: security headers, body caps, content-type allow-list, cache-control | — | 2025-04-16 |
| 2 infra | Ingress templates (CrowdSec parsers, Caddy config) | — | 2025-04-16 |
| 2 docs | This file | — | 2025-04-16 |
| 2.1 | One-shot installer + `nexus doctor` health probe | — | 2026-04-17 |
| 2.2 | Security headers moved to `next.config.ts`; Caddy demoted to optional | — | 2026-04-17 |
| 2.3 | Quick-win bundle: H8 exec timeout, M2 session rotation, M11 slug tightening | — | 2026-04-17 |
| A–H | Remediation of the 2026-04-18 full-code review (distinct from the H-numbers in this file): silent-failure counters + `/api/system/health`, PVE renewal back-off, `userHasPrivilege` probe-error differentiation (http\_5xx / transport / parse), Redis auto-fallback, critical-primitive test coverage | v0.4.5 – v0.7.0 | 2026-04-17 |
| 0.7.x | Tier-4 cleanup: route middleware (`withAuth`/`withCsrf`), `useCsrfMutation` hook, POLL_INTERVALS centralisation, branded phantom types (`VmId`/`NodeName`/`Userid`/`BatchId`/`Slug`/`SafeRelPath`), scored-target discriminated union | v0.7.1 – v0.8.0 | 2026-04-17 |
| 0.8.x | Code hygiene: full lint-warning sweep, severity colour-token migration (238 sites), `BulkItem` / `ChainStepRun` / `PVETask` discriminated unions with JSON-migration sanitiser, bundle audit + dead-type trim | v0.8.1 – v0.8.6 | 2026-04-18 |
| 0.9.x | Brand adoption on `PVEAuthSession.{ticket, csrfToken, username}` with parse-on-ingress on login + renewal; eight additional routes migrated to `withAuth`/`withCsrf`; `CsrfToken` vs `PveCsrfToken` brand split (hotfix — PVE's CSRFPreventionToken format ≠ Nexus's 64-hex shape, conflating them was breaking all logins) | v0.9.0 – v0.9.2 | 2026-04-18 |

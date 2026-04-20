# Security Hardening Pass (Roadmap §8.3, Top-10 #10)

**Date:** 2026-04-20
**Release target:** v0.33.0
**Predecessor:** v0.32.1 (Tier 5 closed — damped Holt's capacity forecast)
**Status:** design approved, pending implementation plan

## Context

The original Top-10 listed eight intelligence/UX features and two hardening
items. As of 2026-04-20, items #1–#9 have shipped (Tag/Folder view, Unit
Picker, Audit Log UI, Notification Rule Engine, Auto-DRS, Next-fire + run
history, Widget DnD, Guest-Internal Health, Remote Cluster Registry is the
next Tier-6 item). Item #10 — the roadmap §8.3 security-hardening pass — is
the last hardening ship before Tier 6 federation begins.

Landing 8.3 *before* 6.1 is deliberate: 6.1 adds a multi-endpoint `?cluster=`
parameter to the proxy, and bolting federation onto an unhardened proxy would
mean rewriting the allowlist later.

## Goals

A single bundled PR → v0.33.0 tag covering:

1. Proxy path allowlist (top-level PVE resource families).
2. Security response headers on every Next route via the custom HTTP server.
3. Audit + document that `rehype-raw` is absent from the markdown pipeline.
4. `safe-regex` CI gate across the repo.
5. Community-scripts SSRF invariant locked in by tests.

## Non-goals

- Nonce-based strict CSP (Next 16 RSC requires `unsafe-inline`/`unsafe-eval`;
  a nonce migration is a Tier 8 follow-up).
- WAF/IDS, subresource integrity, canonical-origin enforcement.
- Changes to auth, CSRF, session, or cookie code — all already hardened in
  prior phases.

## Architecture

Three layers are touched; no new runtime dependencies.

| Layer | File | Change shape |
|-------|------|--------------|
| Edge  | `nexus/server.ts` | Add `applySecurityHeaders(req, res)`; call before `handle()` in the `createServer` handler. |
| Proxy | `nexus/src/app/api/proxmox/[...path]/route.ts` | Add `ALLOWED_TOP_LEVEL` constant + 403 on miss, next to the existing `invalidSegment()` loop. |
| Dev tooling | `nexus/scripts/audit-unsafe-regex.ts`, `nexus/tests/security/*` | New audit script + 4 vitest files. `safe-regex` added as devDep only. |

Rollback = revert commit. All changes are additive to existing defense-in-depth
primitives (path validation, content-type allowlist, body-size cap, CSRF
double-submit, scoped TLS bypass).

## Item specs

### 1. Proxy path allowlist

**File:** `nexus/src/app/api/proxmox/[...path]/route.ts`

Add a top-level resource allowlist immediately after the existing
`invalidSegment()` loop:

```ts
const ALLOWED_TOP_LEVEL = new Set([
  'cluster', 'nodes', 'storage', 'access', 'pools', 'version',
]);

// Empty path is already rejected by the invalidSegment loop above (empty
// segment fails the `seg === ''` check). path[0] is therefore defined
// here, but the explicit length check keeps the intent readable.
if (path.length === 0 || !ALLOWED_TOP_LEVEL.has(path[0])) {
  return hardenedJson(
    { error: 'Resource not proxied' },
    { status: 403 },
  );
}
```

**Rationale:** the PVE_BASE constant already pins us to `/api2/json/`, but the
catch-all `[...path]` route accepts *any* tree beneath it. The allowlist
narrows the attack surface to only the resource families Nexus genuinely
consumes. Experimental or deprecated PVE endpoints (e.g. `/proxy`, `/api`) are
unreachable via Nexus even if a future bug crafts a path through the other
guards.

**Tests:** extend the existing proxy route test file with:
- one case per allowlisted top-level (smoke pass-through).
- one case for a disallowed top-level (`/api/proxmox/evil` → 403).
- one case ensuring the allowlist runs *after* the invalid-segment check (so
  `/api/proxmox/../etc/passwd` still returns 400, not 403).

### 2. Security headers in custom server

**File:** `nexus/server.ts`

Add a helper called inside the HTTP request handler before `handle()`:

```ts
function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // HSTS only when the request actually arrived over TLS, directly or via
  // an ingress that set X-Forwarded-Proto. Emitting HSTS on plain HTTP
  // dev traffic would brick localhost testing in browsers that cache it.
  // `encrypted` is only present on TLSSocket; the `in` check avoids a type
  // assertion that could lie if the socket shape changes in future Node.
  const secure =
    ('encrypted' in req.socket && req.socket.encrypted === true) ||
    req.headers['x-forwarded-proto'] === 'https';
  if (secure) {
    res.setHeader('Strict-Transport-Security',
      'max-age=15552000; includeSubDomains');
  }
}
```

**CSP directive list:**

```
default-src 'self';
script-src  'self' 'unsafe-inline' 'unsafe-eval';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
font-src    'self' data:;
connect-src 'self' ws: wss:;
frame-src   'self';
object-src  'none';
base-uri    'self';
form-action 'self';
frame-ancestors 'self';
```

Directive rationale:
- `script-src 'unsafe-inline' 'unsafe-eval'` — required by Next 16 RSC
  runtime and its inline hydration payloads. Tightening to nonces is a
  Tier 8 follow-up.
- `style-src 'unsafe-inline'` — required by Tailwind v4's CSS-in-JS code-path
  and the component library's style-tag injection.
- `img-src data: blob:` — React icon sprites, canvas-rendered charts.
- `connect-src ws: wss:` — noVNC and xterm.js websocket relay.
- `frame-src 'self'` — iframed `vnc.html`.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — Helmet
  defaults; no legitimate use for any of these in Nexus.

**Why not Helmet.js:** Helmet is middleware for Express. Our custom server
uses Node's `createServer` directly, so adopting Helmet would mean writing a
Connect-style adapter. A direct `res.setHeader()` helper is ~15 lines and
easier to audit than the adapter plus Helmet's codepath.

**Tests:** new `tests/security/headers.test.ts`
- asserts each header on a mock `ServerResponse`.
- asserts HSTS present when `x-forwarded-proto: https`.
- asserts HSTS *absent* on plain HTTP.

### 3. rehype-raw audit

**Audit result:** markdown is rendered only in
`nexus/src/app/(app)/dashboard/system/updates/page.tsx` via `react-markdown`
+ `remark-gfm`. `rehype-raw` is **not** in the pipeline. `react-markdown`
escapes raw HTML by default, so GitHub release notes are safe to render.

**Changes:**
- Inline comment next to the `ReactMarkdown` usage noting the invariant.
- New test `tests/security/markdown-pipeline.test.ts` that reads
  `nexus/package.json` + `nexus/package-lock.json` and asserts `rehype-raw`
  appears in neither. Locks the invariant so a future dep add trips CI.

### 4. `safe-regex` audit + CI gate

**DevDep:** `safe-regex` (MIT, zero deps, maintained).

**Script:** `nexus/scripts/audit-unsafe-regex.ts` — walks `src/**/*.{ts,tsx}`
via the TypeScript compiler API (already a project dep), finds:
- regex literals (`/pattern/flags`),
- `new RegExp('pattern')` with string-literal arg (dynamic args are skipped
  with a warning).

Each is fed to `safe-regex`. Output is JSON array
`{ file, line, col, pattern, safe }`. Writes to stdout; exit 1 if any unsafe.

**Test:** `tests/security/regex-audit.test.ts` invokes the script via
`execFileSync`, parses stdout, asserts zero unsafe entries. Runs in the
default `vitest` pass and therefore in CI.

**Why a test not a pre-commit hook:** hooks can be bypassed with
`--no-verify`; a failing test breaks CI unconditionally.

**Expected baseline:** zero unsafe regexes.
- `cron-match.ts` is hand-rolled, zero regex.
- `community-scripts.ts` uses `^[a-z0-9][a-z0-9-]{0,62}$` — bounded, safe.
- Other regex usage in the codebase is linear in form (no nested
  quantifiers) per spot-check.

Any future regression shows up in CI with line-precise diagnostics.

### 5. Community-scripts SSRF test

**No logic change.** `community-scripts.ts` already:
- pins `REPO_RAW_BASE = 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main'`,
- validates slugs with `^[a-z0-9][a-z0-9-]{0,62}$`.

**New test:** `tests/security/community-scripts-ssrf.test.ts` feeds crafted
slugs through the path builder and asserts rejection:
- `'../../../etc/passwd'` → reject.
- `'foo@evil.com'` → reject.
- `'https://attacker.com/raw'` → reject.
- `'a'.repeat(200)` → reject (length bound).
- `'FOO'` → reject (case bound).
- `'-foo'` → reject (leading-hyphen bound).
- valid slug `'jellyfin'` → accept, produces URL under `REPO_RAW_BASE`.

Locks the invariant so a future regex loosening is caught.

## Error handling

- Proxy allowlist rejection uses the existing `hardenedJson` builder
  (already sets `Cache-Control: no-store, private`).
- HSTS gating uses a conservative secure-transport check to avoid breaking
  `npm run dev` over plain HTTP. If neither `x-forwarded-proto` nor
  `socket.encrypted` indicates TLS, HSTS is omitted.
- Audit script failures produce machine-readable JSON on stderr plus a
  human-readable summary line on stdout; exit code drives CI.
- No runtime impact from the audit or tests — they're dev/CI only.

## Testing summary

| Test file | Kind | Asserts |
|-----------|------|---------|
| Existing proxy route test | extended | allowlist pass/reject cases |
| `tests/security/headers.test.ts` | unit | each header present; HSTS TLS-gated |
| `tests/security/markdown-pipeline.test.ts` | dep-lock | `rehype-raw` absent from package.json + lockfile |
| `tests/security/regex-audit.test.ts` | CI gate | audit script reports zero unsafe |
| `tests/security/community-scripts-ssrf.test.ts` | invariant | slug validator rejects crafted inputs |

No new E2E. Each piece is testable in isolation.

## Rollout

- Single PR → merge → tag `v0.33.0` → push (auto-ship per `feedback_auto_ship`).
- Roadmap doc: move 8.3 from "Security & hardening" to "Completed 2026-04-20"
  under a new v0.33.0 release-history section.
- Wiki updates:
  - Configuration page → add "Security headers" subsection listing the CSP
    directive set and the HSTS gating behaviour.
  - FAQ page → new entry "Is Nexus safe behind a public ingress?" pointing
    at the CSP/HSTS footprint and the allowlist.
- Serena memory:
  - New memory `phase_security_hardening_8_3_landed.md` with the shipping
    date, tag, and file footprint.
  - Update the Tier 5 state memory's sibling note to cross-reference 8.3
    done.
- Auto-memory `MEMORY.md`: new entry under Project memories.

## Open questions

None blocking. Deferred items captured:
- Nonce-based strict CSP → Tier 8 follow-up, depends on Next 16 RSC getting
  a stable nonce plumbing story.
- `subresource-integrity` on community-script fetches → deferred;
  upstream ProxmoxVE repo doesn't publish SRI hashes.

## Dependencies

None. Does not block or unblock any other roadmap item directly. Landing it
*before* 6.1 Remote Cluster Registry is strongly preferred so federation can
be built on an already-narrowed allowlist rather than widening one retroactively.

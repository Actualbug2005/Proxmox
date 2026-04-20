# Security Hardening Pass (8.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the roadmap §8.3 security-hardening pass as v0.33.0 — proxy top-level allowlist, security response headers, rehype-raw audit, safe-regex CI gate, community-scripts SSRF invariant.

**Architecture:** Five minimal-delta changes across three layers (edge/proxy/dev-tooling). No new runtime deps. Each task is TDD: test first, implementation second, commit third.

**Tech Stack:** TypeScript, Next.js 16 (custom HTTP server), Node `createServer`, vitest, `safe-regex` (devDep only).

**Spec:** `docs/superpowers/specs/2026-04-20-security-hardening-8-3-design.md` (commit `6443d2a`).

---

## Preflight

### Task 0: Preflight — GitNexus impact + clean working tree

**Files:** (read-only)

- [ ] **Step 0.1: Confirm clean working tree**

Run: `git status --porcelain`
Expected: empty output (no uncommitted changes).

- [ ] **Step 0.2: Impact-check the two files we will modify**

Use the GitNexus MCP tool `impact` with target `handler` in `nexus/src/app/api/proxmox/[...path]/route.ts` — expected direct callers: Next.js route dispatch only. Then run it for `applySecurityHeaders` — expected: not yet present, so impact returns zero (new symbol).

Do the same for the `httpServer` `createServer` callback in `nexus/server.ts` — it's an entry point; direct callers are the Node runtime. Risk: LOW.

If GitNexus warns the index is stale, run `npx gitnexus analyze --embeddings` first (the spec commit `6443d2a` already triggered a reindex, but a second run is cheap).

- [ ] **Step 0.3: Create a feature branch (optional — single PR ship)**

Run: `git checkout -b feat/security-hardening-8-3`

If you prefer to land directly on `main` per the auto-ship workflow, skip this step.

---

## Task 1 — Proxy top-level allowlist

**Files:**
- Modify: `nexus/src/app/api/proxmox/[...path]/route.ts` (add `ALLOWED_TOP_LEVEL` constant + guard right after the existing `invalidSegment()` loop around line 116–124).
- Modify (tests): find the existing proxy route test file (likely `nexus/tests/api/proxmox-proxy.test.ts` or `nexus/src/app/api/proxmox/[...path]/route.test.ts` — `ls nexus/tests/api/ nexus/src/app/api/proxmox/` to locate).

- [ ] **Step 1.1: Locate the existing proxy route test file**

Run: `find nexus -name "*.test.ts" -path "*proxmox*" -not -path "*/node_modules/*"`
Expected: at least one file; record its path as `$PROXY_TEST`.

- [ ] **Step 1.2: Write three new failing tests**

Append to `$PROXY_TEST`:

```ts
describe('top-level resource allowlist', () => {
  it('accepts allowlisted top-level resources', async () => {
    // Follow the pattern used by the existing tests — build a mock
    // NextRequest for /api/proxmox/cluster/resources, invoke the GET
    // handler, assert the response is NOT 403 (it may be 401 if auth
    // is not mocked; the point is that the allowlist does not reject).
    const { GET } = await import('@/app/api/proxmox/[...path]/route');
    const req = buildProxyRequest('GET', ['cluster', 'resources']);
    const res = await GET(req, { params: Promise.resolve({ path: ['cluster', 'resources'] }) });
    expect(res.status).not.toBe(403);
  });

  it('rejects non-allowlisted top-level resources', async () => {
    const { GET } = await import('@/app/api/proxmox/[...path]/route');
    const req = buildProxyRequest('GET', ['evil']);
    const res = await GET(req, { params: Promise.resolve({ path: ['evil'] }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not proxied/i);
  });

  it('invalid-segment check runs before allowlist (..  returns 400 not 403)', async () => {
    const { GET } = await import('@/app/api/proxmox/[...path]/route');
    const req = buildProxyRequest('GET', ['..', 'etc', 'passwd']);
    const res = await GET(req, { params: Promise.resolve({ path: ['..', 'etc', 'passwd'] }) });
    expect(res.status).toBe(400);
  });
});
```

Note: `buildProxyRequest` is the existing test helper in `$PROXY_TEST`. If the helper has a different name, use it — do not invent new fixtures.

- [ ] **Step 1.3: Run tests — expect failures**

Run: `cd nexus && npx vitest run $PROXY_TEST`
Expected: the two new "allowlist" cases fail (503/unhandled), the `..` case already passes (existing invalidSegment guard).

- [ ] **Step 1.4: Add the allowlist to the route**

Edit `nexus/src/app/api/proxmox/[...path]/route.ts`. Right after the existing `invalidSegment()` loop that ends around line 124 (look for `const pathStr = path.join('/');`), insert:

```ts
  // ── Top-level resource allowlist (8.3) ──────────────────────────────────
  // Narrow the catch-all from "any /api2/json/<anything>" to only the PVE
  // resource families Nexus actually consumes. Defense in depth: even if a
  // future routing bug threads a crafted path past the segment validator,
  // it cannot reach non-allowlisted PVE trees.
  if (path.length === 0 || !ALLOWED_TOP_LEVEL.has(path[0])) {
    return hardenedJson(
      { error: 'Resource not proxied' },
      { status: 403 },
    );
  }
```

Then add the constant near the top, alongside `MUTATING` and `MAX_BODY_BYTES`:

```ts
/** Top-level PVE resource families Nexus consumes. Anything else is 403.
 *  Adding a new family here is a conscious widening decision. */
const ALLOWED_TOP_LEVEL = new Set([
  'cluster', 'nodes', 'storage', 'access', 'pools', 'version',
]);
```

- [ ] **Step 1.5: Run tests — expect pass**

Run: `cd nexus && npx vitest run $PROXY_TEST`
Expected: all three new cases pass; no regressions in existing cases.

- [ ] **Step 1.6: Commit**

```bash
git add nexus/src/app/api/proxmox/\[...path\]/route.ts $PROXY_TEST
git commit -m "$(cat <<'EOF'
feat(security): proxy top-level resource allowlist (8.3 part 1)

Narrow /api/proxmox/[...path] to only the PVE resource families Nexus
consumes: cluster, nodes, storage, access, pools, version. Everything
else returns 403. Defense in depth atop the existing invalid-segment
and content-type guards.
EOF
)"
```

---

## Task 2 — Security headers in custom server

**Files:**
- Modify: `nexus/server.ts` (add `applySecurityHeaders` helper near the top-of-module constants; invoke it inside the `createServer` callback at line ~187).
- Create: `nexus/tests/security/headers.test.ts`.

- [ ] **Step 2.1: Create the tests directory**

Run: `mkdir -p nexus/tests/security`

- [ ] **Step 2.2: Write the failing test file**

Create `nexus/tests/security/headers.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

// applySecurityHeaders is exported from server.ts once Task 2.4 lands.
// Import path uses a .ts extension to match the project's ESM strip-types convention.
import { applySecurityHeaders } from '../../server.ts';

function mockRes(): ServerResponse & { __headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((k: string, v: string) => { headers[k.toLowerCase()] = v; }),
    __headers: headers,
  } as unknown as ServerResponse & { __headers: Record<string, string> };
  return res;
}

function mockReq(opts: { tls: boolean; xfProto?: string }): IncomingMessage {
  return {
    socket: { encrypted: opts.tls } as unknown as Socket,
    headers: opts.xfProto ? { 'x-forwarded-proto': opts.xfProto } : {},
  } as unknown as IncomingMessage;
}

describe('applySecurityHeaders', () => {
  it('sets CSP, X-Content-Type-Options, Referrer-Policy, X-Frame-Options on every request', () => {
    const res = mockRes();
    applySecurityHeaders(mockReq({ tls: false }), res);
    expect(res.__headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.__headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(res.__headers['x-content-type-options']).toBe('nosniff');
    expect(res.__headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.__headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('sets HSTS when the socket is TLS-encrypted', () => {
    const res = mockRes();
    applySecurityHeaders(mockReq({ tls: true }), res);
    expect(res.__headers['strict-transport-security']).toMatch(/max-age=15552000/);
  });

  it('sets HSTS when X-Forwarded-Proto is https', () => {
    const res = mockRes();
    applySecurityHeaders(mockReq({ tls: false, xfProto: 'https' }), res);
    expect(res.__headers['strict-transport-security']).toBeDefined();
  });

  it('omits HSTS on plain HTTP (no TLS, no xf-proto)', () => {
    const res = mockRes();
    applySecurityHeaders(mockReq({ tls: false }), res);
    expect(res.__headers['strict-transport-security']).toBeUndefined();
  });

  it('CSP allows ws: / wss: in connect-src (noVNC + xterm)', () => {
    const res = mockRes();
    applySecurityHeaders(mockReq({ tls: false }), res);
    expect(res.__headers['content-security-policy']).toMatch(/connect-src[^;]+ws:/);
    expect(res.__headers['content-security-policy']).toMatch(/connect-src[^;]+wss:/);
  });
});
```

- [ ] **Step 2.3: Run the test — expect it to fail with "not exported"**

Run: `cd nexus && npx vitest run tests/security/headers.test.ts`
Expected: failure — `applySecurityHeaders` not exported from `server.ts`.

- [ ] **Step 2.4: Implement `applySecurityHeaders` and invoke it**

Edit `nexus/server.ts`. Add the helper near the top-of-module constants (after `URL_BASE`):

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

// Strict CSP is a Tier 8 follow-up (requires Next 16 RSC nonce plumbing).
// Current directives allow Tailwind v4 + RSC inline hydration and the
// noVNC/xterm websocket relay. See spec §2.2 for per-directive rationale.
const CSP = [
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

export function applySecurityHeaders(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // HSTS only when the request actually arrived over TLS (directly or via
  // an ingress that set X-Forwarded-Proto). Emitting HSTS on plain-HTTP
  // dev traffic would brick localhost testing in browsers that cache it.
  const socket = req.socket as unknown as { encrypted?: boolean };
  const secure =
    (socket && socket.encrypted === true) ||
    req.headers['x-forwarded-proto'] === 'https';
  if (secure) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=15552000; includeSubDomains',
    );
  }
}
```

Then invoke it inside the `createServer` callback. Locate the existing code around line 187:

```ts
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });
```

Change to:

```ts
  const httpServer = createServer((req, res) => {
    applySecurityHeaders(req, res);
    handle(req, res);
  });
```

- [ ] **Step 2.5: Run the test — expect pass**

Run: `cd nexus && npx vitest run tests/security/headers.test.ts`
Expected: all 5 cases pass.

- [ ] **Step 2.6: Run the full test suite to check for regressions**

Run: `cd nexus && npx vitest run`
Expected: all pre-existing tests still pass (WS relay, CSRF, proxy route, etc).

- [ ] **Step 2.7: Commit**

```bash
git add nexus/server.ts nexus/tests/security/headers.test.ts
git commit -m "$(cat <<'EOF'
feat(security): CSP/HSTS/nosniff/referrer-policy on every response (8.3 part 2)

Add applySecurityHeaders helper in the custom HTTP server so every Next
route and API gets CSP (RSC + Tailwind-compatible), HSTS (TLS-gated to
avoid bricking dev), X-Content-Type-Options, Referrer-Policy, and
X-Frame-Options. Hand-rolled rather than Helmet because our server uses
node:http directly, not Express.
EOF
)"
```

---

## Task 3 — rehype-raw audit (dep-lock invariant)

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/system/updates/page.tsx` (add inline safety comment near line 186).
- Create: `nexus/tests/security/markdown-pipeline.test.ts`.

- [ ] **Step 3.1: Write the failing test**

Create `nexus/tests/security/markdown-pipeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dep-lock invariant: react-markdown escapes raw HTML by default. Adding
// rehype-raw to the pipeline would reintroduce the XSS surface. This test
// fails if rehype-raw ever lands in package.json or the lockfile.
describe('markdown-pipeline XSS surface', () => {
  it('rehype-raw is absent from package.json (direct or dev)', () => {
    const pkgPath = resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies?.['rehype-raw']).toBeUndefined();
    expect(pkg.devDependencies?.['rehype-raw']).toBeUndefined();
  });

  it('rehype-raw is absent from package-lock.json (transitive)', () => {
    const lockPath = resolve(__dirname, '../../package-lock.json');
    const raw = readFileSync(lockPath, 'utf8');
    // Match the npm-lockfile-v3 package-key shape: "node_modules/rehype-raw".
    expect(raw).not.toMatch(/"node_modules\/rehype-raw"/);
  });
});
```

- [ ] **Step 3.2: Run the test — expect pass (it should already pass today)**

Run: `cd nexus && npx vitest run tests/security/markdown-pipeline.test.ts`
Expected: both cases pass. If either fails, `rehype-raw` slipped in somewhere and needs removal before proceeding.

- [ ] **Step 3.3: Add inline safety comment to the markdown render site**

Edit `nexus/src/app/(app)/dashboard/system/updates/page.tsx`. Find the `<ReactMarkdown` JSX around line 186 and add a comment immediately above the opening tag:

```tsx
{/* Security: no rehype-raw in the pipeline — react-markdown escapes raw
    HTML by default. GitHub release bodies are rendered text-only.
    Invariant locked by tests/security/markdown-pipeline.test.ts. */}
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  ...
```

- [ ] **Step 3.4: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/system/updates/page.tsx nexus/tests/security/markdown-pipeline.test.ts
git commit -m "$(cat <<'EOF'
docs(security): lock rehype-raw absence invariant (8.3 part 3)

react-markdown escapes raw HTML by default; the updates page renders
GitHub release notes text-only. Lock this behaviour with a dep-lockfile
invariant test and an inline comment next to the render site.
EOF
)"
```

---

## Task 4 — safe-regex CI gate

**Files:**
- Modify: `nexus/package.json` (add `safe-regex` to devDependencies).
- Create: `nexus/scripts/audit-unsafe-regex.ts`.
- Create: `nexus/tests/security/regex-audit.test.ts`.

- [ ] **Step 4.1: Add `safe-regex` devDep**

Run: `cd nexus && npm install --save-dev safe-regex`
Expected: package-lock.json updated, `safe-regex` added to devDependencies. `safe-regex` has a bundled CJS export; in our ESM project use it via `createRequire` (see Step 4.3).

- [ ] **Step 4.2: Write the failing audit test first**

Create `nexus/tests/security/regex-audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('regex audit', () => {
  it('reports zero unsafe regex patterns across nexus/src', () => {
    const scriptPath = resolve(__dirname, '../../scripts/audit-unsafe-regex.ts');
    let stdout: string;
    try {
      stdout = execFileSync(
        process.execPath,
        ['--experimental-strip-types', scriptPath],
        { encoding: 'utf8', cwd: resolve(__dirname, '../..') },
      );
    } catch (err: unknown) {
      // Non-zero exit is a test failure — include the output for diagnostics.
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
      const out = String(e.stdout ?? '') + String(e.stderr ?? '');
      throw new Error(`audit script exited non-zero:\n${out}`);
    }
    const findings = JSON.parse(stdout) as Array<{ file: string; line: number; pattern: string; safe: boolean }>;
    const unsafe = findings.filter((f) => !f.safe);
    if (unsafe.length > 0) {
      const msg = unsafe
        .map((u) => `${u.file}:${u.line}  /${u.pattern}/`)
        .join('\n');
      throw new Error(`Unsafe regex patterns found:\n${msg}`);
    }
    expect(unsafe).toHaveLength(0);
  });
});
```

- [ ] **Step 4.3: Run the test — expect it to fail with "script not found"**

Run: `cd nexus && npx vitest run tests/security/regex-audit.test.ts`
Expected: failure — `scripts/audit-unsafe-regex.ts` does not exist yet.

- [ ] **Step 4.4: Implement the audit script**

Create `nexus/scripts/audit-unsafe-regex.ts`:

```ts
/**
 * Audit every regex literal and `new RegExp('...')` call in nexus/src for
 * catastrophic-backtracking risk. Emits a JSON array to stdout:
 *
 *   [{ file, line, col, pattern, safe }]
 *
 * Exit 0 if every pattern is safe, exit 1 otherwise (so CI fails loudly).
 *
 * Dynamic-arg `new RegExp(someVar)` calls are skipped (can't audit at
 * static-analysis time) but emitted as `{ ..., pattern: '<dynamic>', safe: true }`
 * so the operator can grep for them if worried.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const safe = require('safe-regex') as (pattern: string | RegExp) => boolean;

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

interface Finding {
  file: string;
  line: number;
  col: number;
  pattern: string;
  safe: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function auditFile(file: string): Finding[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];

  function visit(node: ts.Node): void {
    if (ts.isRegularExpressionLiteral(node)) {
      const text = node.text; // includes slashes + flags
      // Strip leading /, trailing /flags to get the pattern.
      const body = text.replace(/^\/(.*)\/[gimsuy]*$/, '$1');
      const pos = sf.getLineAndCharacterOfPosition(node.getStart());
      findings.push({
        file: relative(ROOT, file),
        line: pos.line + 1,
        col: pos.character + 1,
        pattern: body,
        safe: safe(body),
      });
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'RegExp'
    ) {
      const arg = node.arguments?.[0];
      const pos = sf.getLineAndCharacterOfPosition(node.getStart());
      if (arg && ts.isStringLiteral(arg)) {
        findings.push({
          file: relative(ROOT, file),
          line: pos.line + 1,
          col: pos.character + 1,
          pattern: arg.text,
          safe: safe(arg.text),
        });
      } else {
        findings.push({
          file: relative(ROOT, file),
          line: pos.line + 1,
          col: pos.character + 1,
          pattern: '<dynamic>',
          safe: true,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return findings;
}

const files = walk(SRC);
const all: Finding[] = [];
for (const f of files) all.push(...auditFile(f));

process.stdout.write(JSON.stringify(all, null, 2));
const unsafe = all.filter((f) => !f.safe);
process.exit(unsafe.length === 0 ? 0 : 1);
```

- [ ] **Step 4.5: Run the audit script manually to spot-check output**

Run: `cd nexus && node --experimental-strip-types scripts/audit-unsafe-regex.ts | head -40`
Expected: JSON array printed, exit 0. Skim the patterns — every `safe: false` is a real finding that must be fixed before the test will pass.

- [ ] **Step 4.6: Run the test — expect pass**

Run: `cd nexus && npx vitest run tests/security/regex-audit.test.ts`
Expected: pass. If any unsafe pattern is found, the test output lists `file:line  /pattern/` for each — fix each pattern (usually by bounding quantifiers) before proceeding. Do not commit until the audit is clean.

- [ ] **Step 4.7: Commit**

```bash
git add nexus/package.json nexus/package-lock.json nexus/scripts/audit-unsafe-regex.ts nexus/tests/security/regex-audit.test.ts
git commit -m "$(cat <<'EOF'
feat(security): safe-regex CI gate (8.3 part 4)

Static-analysis walker over src/**/*.ts{,x} that feeds every regex literal
and new RegExp() string-literal arg through safe-regex. Baseline today:
zero unsafe patterns. A vitest test locks the invariant so future
regressions fail CI with line-precise diagnostics.
EOF
)"
```

---

## Task 5 — Community-scripts SSRF invariant test

**Files:**
- Create: `nexus/tests/security/community-scripts-ssrf.test.ts`.

- [ ] **Step 5.1: Inspect the community-scripts slug validator**

Run: `cd nexus && grep -n "slug\|REPO_RAW_BASE\|^const" src/lib/community-scripts.ts | head -30`

Locate:
- the `REPO_RAW_BASE` constant (around line 46),
- the slug validator function (around line 491 — contains `^[a-z0-9][a-z0-9-]{0,62}$`).

Record the function name (e.g. `validateSlug`, `buildScriptUrl`, or whatever is exported). Call it `$SLUG_FN` below.

- [ ] **Step 5.2: Write the invariant test**

Create `nexus/tests/security/community-scripts-ssrf.test.ts`. Replace `$SLUG_FN` with the real name you found in 5.1, and replace the import path with whatever is actually exported:

```ts
import { describe, it, expect } from 'vitest';
// Replace with the actual exported name + module path from Step 5.1.
import { $SLUG_FN as subjectUnderTest } from '../../src/lib/community-scripts';

describe('community-scripts SSRF guard', () => {
  const attackSlugs: Array<[string, string]> = [
    ['path traversal', '../../../etc/passwd'],
    ['at-sign', 'foo@evil.com'],
    ['full URL', 'https://attacker.com/raw'],
    ['length bound', 'a'.repeat(200)],
    ['uppercase', 'FOO'],
    ['leading hyphen', '-foo'],
    ['empty', ''],
    ['whitespace', 'jelly fin'],
  ];

  for (const [label, slug] of attackSlugs) {
    it(`rejects crafted slug: ${label}`, () => {
      // The validator either throws or returns false — accept either shape.
      expect(() => {
        const result = subjectUnderTest(slug);
        if (result !== false) throw new Error('accepted');
      }).toThrow();
    });
  }

  it('accepts a canonical valid slug', () => {
    // Adjust assertion once you confirm the function's return shape.
    // If it returns a URL string, assert it starts with REPO_RAW_BASE.
    // If it returns a boolean, assert true. Keep whichever matches.
    const result = subjectUnderTest('jellyfin');
    if (typeof result === 'string') {
      expect(result).toMatch(/^https:\/\/raw\.githubusercontent\.com\/community-scripts\/ProxmoxVE\//);
    } else {
      expect(result).toBe(true);
    }
  });
});
```

If the function signature turns out to need multiple args (e.g. slug + category), adapt the test call shape — do not invent new exports from the module.

- [ ] **Step 5.3: Run the test — expect pass**

Run: `cd nexus && npx vitest run tests/security/community-scripts-ssrf.test.ts`
Expected: all 9 cases pass. If any crafted slug is accepted, the validator is too loose and must be tightened before proceeding.

- [ ] **Step 5.4: Commit**

```bash
git add nexus/tests/security/community-scripts-ssrf.test.ts
git commit -m "$(cat <<'EOF'
test(security): community-scripts SSRF invariant (8.3 part 5)

Lock the slug validator's rejection of path traversal, full URLs,
length/case/hyphen-prefix violations, and whitespace. REPO_RAW_BASE and
the validator regex are already tight; this test ensures any future
loosening is caught by CI.
EOF
)"
```

---

## Task 6 — Roadmap + memory + wiki updates

**Files:**
- Modify: `docs/superpowers/specs/2026-04-18-nexus-roadmap.md` (add v0.33.0 release entry, move 8.3 to completed).
- Modify: Serena memory via `write_memory` (new `phase_security_hardening_8_3_landed` memory).
- Modify: `/Users/devlin/.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/MEMORY.md` + new memory file `project_security_hardening_8_3.md`.
- Modify: wiki pages (Configuration, FAQ) under `wiki/` if they exist.

- [ ] **Step 6.1: Update the roadmap doc**

Edit `docs/superpowers/specs/2026-04-18-nexus-roadmap.md`. Under the Top-10 section, mark #10 as shipped by appending an inline note:

```
10. 8.3 Security hardening pass — 2d, L/H. **Shipped 2026-04-20 as v0.33.0.**
```

Add a new release-history section near the bottom (before "Dependencies"):

```
## Release history

- **v0.33.0** (2026-04-20) — 8.3 security hardening: proxy top-level
  allowlist, CSP/HSTS/nosniff/referrer-policy headers, rehype-raw audit,
  safe-regex CI gate, community-scripts SSRF invariant test.
```

- [ ] **Step 6.2: Write Serena memory**

Use the Serena MCP `write_memory` tool with name `phase_security_hardening_8_3_landed` and content:

```
# Security hardening 8.3 landed — v0.33.0 (2026-04-20)

**Tag:** v0.33.0
**Scope:** roadmap Top-10 #10, the last hardening ship before Tier 6 federation.

## What shipped

1. Proxy top-level allowlist in `nexus/src/app/api/proxmox/[...path]/route.ts`.
   Families: cluster, nodes, storage, access, pools, version. 403 otherwise.
2. `applySecurityHeaders(req, res)` in `nexus/server.ts` — CSP, HSTS
   (TLS-gated), nosniff, referrer-policy, x-frame-options on every response.
3. `rehype-raw` absence locked by `nexus/tests/security/markdown-pipeline.test.ts`.
4. `safe-regex` CI gate via `nexus/scripts/audit-unsafe-regex.ts` +
   `nexus/tests/security/regex-audit.test.ts`. Baseline: zero unsafe.
5. Community-scripts SSRF invariant locked by
   `nexus/tests/security/community-scripts-ssrf.test.ts`.

## Deferred

- Nonce-based strict CSP (requires Next 16 RSC nonce plumbing, Tier 8).
- SRI on community-script fetches (upstream repo doesn't publish hashes).

## Impact on 6.1

Next Top-10 item is 6.1 Remote Cluster Registry (federation). The proxy
allowlist is now in place so adding `?cluster=<id>` in 6.1 won't widen
the surface retroactively.
```

- [ ] **Step 6.3: Update auto-memory index + write new entry**

Write `/Users/devlin/.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/project_security_hardening_8_3.md`:

```
---
name: Security hardening 8.3
description: v0.33.0 shipped 2026-04-20 — proxy allowlist, CSP/HSTS headers, safe-regex gate, markdown+SSRF invariants. Tier 6 federation unblocked.
type: project
---

Top-10 #10 closed. Five minimal-delta changes across `nexus/server.ts`,
`nexus/src/app/api/proxmox/[...path]/route.ts`, and four new
`nexus/tests/security/*.test.ts` files. `safe-regex` added as devDep only.

**Why:** the last hardening ship before Tier 6 federation so 6.1's
`?cluster=<id>` parameter builds on an already-narrowed proxy.

**How to apply:** when touching the proxy route, respect `ALLOWED_TOP_LEVEL`
— widening it is a conscious decision, not incidental. When adding new
regex anywhere in `nexus/src/`, the audit test will catch unsafe patterns
at CI time.
```

Then append one line to `/Users/devlin/.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/MEMORY.md`:

```
- [Security hardening 8.3](project_security_hardening_8_3.md) — v0.33.0 (2026-04-20): proxy allowlist, security headers, safe-regex gate, invariants
```

- [ ] **Step 6.4: Update wiki (if applicable)**

Run: `ls wiki/ 2>/dev/null` — if wiki pages exist, edit `wiki/Configuration.md` to add a "Security headers" subsection listing the CSP directives and HSTS gating, and edit `wiki/FAQ.md` (or equivalent) to add "Is Nexus safe behind a public ingress?" pointing at the allowlist + header footprint. If the wiki directory doesn't exist, skip this step.

- [ ] **Step 6.5: Commit docs + memory**

```bash
git add docs/superpowers/specs/2026-04-18-nexus-roadmap.md wiki/ 2>/dev/null
git commit -m "$(cat <<'EOF'
docs: roadmap + wiki updates for 8.3 v0.33.0 release

Mark Top-10 #10 shipped, add v0.33.0 release-history entry, document
security-header footprint in the wiki's Configuration and FAQ pages.
EOF
)"
```

Memory files live outside the repo and are updated via their respective tools, not committed.

---

## Task 7 — Pre-ship verification + release

**Files:** (no file edits — verification + tag + push)

- [ ] **Step 7.1: Full test suite**

Run: `cd nexus && npx vitest run`
Expected: every test passes, including the 4 new security tests and the extended proxy route test.

- [ ] **Step 7.2: Type check**

Run: `cd nexus && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 7.3: GitNexus change scope check**

Use the GitNexus MCP tool `detect_changes` with `scope: "all"`. Expected: affected symbols and files match exactly:
- `nexus/src/app/api/proxmox/[...path]/route.ts` (added `ALLOWED_TOP_LEVEL` + allowlist check)
- `nexus/server.ts` (added `applySecurityHeaders`, one invocation edit)
- `nexus/src/app/(app)/dashboard/system/updates/page.tsx` (comment only)
- `nexus/scripts/audit-unsafe-regex.ts` (new)
- `nexus/tests/security/*.test.ts` (4 new)
- `nexus/package.json`, `nexus/package-lock.json` (safe-regex devDep)
- `docs/superpowers/specs/2026-04-18-nexus-roadmap.md`, `docs/superpowers/specs/2026-04-20-security-hardening-8-3-design.md`, `docs/superpowers/plans/2026-04-20-security-hardening-8-3.md`
- `wiki/*.md` (if present)

If anything unexpected appears, investigate before tagging.

- [ ] **Step 7.4: Bump VERSION and update release-history in the spec**

Edit `nexus/VERSION` (or equivalent — run `cat nexus/VERSION` to confirm the file exists; if Nexus uses `package.json#version` instead, edit that). Set to `0.33.0`.

- [ ] **Step 7.5: Release commit**

```bash
git add nexus/VERSION nexus/package.json
git commit -m "$(cat <<'EOF'
chore(release): v0.33.0 — 8.3 security hardening pass

Proxy top-level allowlist, CSP/HSTS/nosniff/referrer-policy headers on
every response, rehype-raw absence locked by dep-lockfile invariant,
safe-regex CI gate with zero-unsafe baseline, community-scripts SSRF
invariant test. No new runtime dependencies.
EOF
)"
```

- [ ] **Step 7.6: Tag and push**

```bash
git tag -a v0.33.0 -m "v0.33.0 — 8.3 security hardening"
git push origin main
git push origin v0.33.0
```

Per `feedback_auto_ship.md`, no confirmation prompt needed once the phased feature is complete.

- [ ] **Step 7.7: Re-run GitNexus analyze**

The commits triggered the PostToolUse hook; confirm by running
`npx gitnexus analyze --embeddings` once more if the hook didn't fire or reported stale state.

- [ ] **Step 7.8: Verify wiki auto-sync**

Per `project_wiki_sync.md`, a push to main auto-syncs `wiki/` to `.wiki.git`. Check that the sync completed (GitHub Actions or whichever mechanism the project uses). If the wiki wasn't touched in Step 6.4, skip.

---

## Self-Review

**Spec coverage:**
- §Architecture (3 layers) → covered by Tasks 1, 2, 4.
- §2.1 proxy allowlist → Task 1.
- §2.2 security headers → Task 2.
- §2.3 rehype-raw audit → Task 3.
- §2.4 safe-regex audit + CI gate → Task 4.
- §2.5 community-scripts SSRF test → Task 5.
- §6 Rollout (roadmap/memory/wiki) → Task 6; tag + push → Task 7.

Every spec section maps to a task. ✅

**Placeholder scan:** one intentional placeholder — `$SLUG_FN` in Task 5, with explicit instructions to inspect the module in Step 5.1 before writing the test. This is necessary because the exact export name was not verified in the spec phase; the step tells the executor exactly how to resolve it. No TBDs, no vague "handle appropriately" strings.

**Type consistency:** `applySecurityHeaders(req, res)` uses the same signature in the test file (Task 2.2) and the implementation (Task 2.4). `ALLOWED_TOP_LEVEL` is a `Set<string>` consistently. `Finding` type is defined inline in the audit script and referenced in the test via the parsed-JSON shape — shapes match. ✅

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-20-security-hardening-8-3.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

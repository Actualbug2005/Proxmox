/**
 * Guard test: every module reached by `server.ts`'s runtime import
 * chain MUST resolve without the TypeScript path-alias machinery.
 *
 * The tsx loader we use for `npm test` transparently resolves `@/...`
 * via tsconfig paths, so a broken runtime alias won't show up in a
 * normal test run — only in production, where systemd starts Node
 * with `--experimental-strip-types` and no path resolver.
 *
 * v0.16.0 shipped with two such aliases (`exec-audit.ts` and
 * `notifications/crypto.ts`) that crashed the service on boot with
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib/...'`. This test
 * is the guard we wish we'd had — it grep-scans the server.ts
 * transitive chain for any surviving runtime `@/` import.
 *
 * We don't actually spawn Node here (too slow + platform-sensitive);
 * we parse the source and assert no runtime `import { … } from '@/…'`
 * or `export { … } from '@/…'` survives in any reachable file. Type
 * imports (`import type`) are allowed — strip-types erases those.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const SERVER_ENTRY = resolve(REPO_ROOT, 'server.ts');

// A simple regex-based import walker. We only care about files under
// `src/lib` reachable from `server.ts` via relative imports — that's
// the chain Node's raw loader walks. If a future module adds a
// `@/`-aliased dep in that chain, this test catches it before the
// production crash.
// Strategy: split the source into line-strings first, then anchor the
// regex to each line independently. That avoids the failure mode where
// `[^'"]*?` stretches lazily across unrelated type-alias exports on
// preceding lines and eventually hits a real `from '@/...'` clause 10
// lines down — a regex correct in isolation but wrong at file scope.
// Multi-line imports (e.g. destructured member lists that wrap) are
// joined via a preprocess step so the matching stays line-bounded.

function joinContinuations(source: string): string[] {
  // Collapse `import {` + subsequent lines + `} from '…'` into one
  // logical line. Cheap heuristic: if a line ends inside an open brace
  // that has no matching close yet, concatenate.
  const raw = source.split('\n');
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const line of raw) {
    buf = buf ? buf + ' ' + line : line;
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    if (depth <= 0) {
      out.push(buf);
      buf = '';
      depth = 0;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function relativeImportsFrom(source: string): string[] {
  const out: string[] = [];
  // Per-line: `import … from '<rel>'` or `export … from '<rel>'`,
  // including `import type`. We allow type re-exports for walking
  // purposes — the resolved file is still a real file on disk.
  const re = /^\s*(?:import(?:\s+type)?\s+[^;'"]*?from\s+|export(?:\s+type)?\s+[^;'"]*?from\s+)['"]((?:\.\.?\/)[^'"]+)['"]/;
  for (const line of joinContinuations(source)) {
    const m = line.match(re);
    if (m) out.push(m[1]);
  }
  return out;
}

function aliasRuntimeImportsFrom(source: string): string[] {
  // Value imports + re-exports only — `import type` is erased by
  // --experimental-strip-types so it's safe even with `@/` aliases.
  // The negative lookahead on `type` comes BEFORE the member list so
  // `import type { X } from '@/…'` doesn't match.
  const out: string[] = [];
  const re = /^\s*(?:import\s+(?!type\b)[^;'"]*?from\s+|export\s+(?!type\b)[^;'"]*?from\s+)['"](@\/[^'"]+)['"]/;
  for (const line of joinContinuations(source)) {
    const m = line.match(re);
    if (m) out.push(m[1]);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  const base = dirname(from);
  const candidates = [
    resolve(base, spec),
    resolve(base, spec.replace(/\.ts$/, '')) + '.ts',
    resolve(base, spec, 'index.ts'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c, 'utf8');
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

function walk(entry: string): { visited: Set<string>; aliasViolations: Map<string, string[]> } {
  const visited = new Set<string>();
  const violations = new Map<string, string[]>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const aliases = aliasRuntimeImportsFrom(src);
    if (aliases.length > 0) violations.set(file, aliases);
    for (const spec of relativeImportsFrom(src)) {
      const resolved = resolveImport(file, spec);
      if (resolved) stack.push(resolved);
    }
  }
  return { visited, aliasViolations: violations };
}

describe('server.ts runtime import chain', () => {
  it('contains no value/re-export `@/` aliases (they crash under --experimental-strip-types)', () => {
    const { visited, aliasViolations } = walk(SERVER_ENTRY);
    assert.ok(visited.size > 5, 'sanity: chain reached at least a handful of files');
    if (aliasViolations.size > 0) {
      const report = [...aliasViolations].map(
        ([file, aliases]) => `  ${file}\n    ${aliases.join('\n    ')}`,
      ).join('\n');
      assert.fail(
        `Runtime @/ aliases found in server.ts chain — will crash production:\n${report}\n\n` +
        'Convert to relative `./path.ts` imports. `import type` with @/ is fine.',
      );
    }
  });
});

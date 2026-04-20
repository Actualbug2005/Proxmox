/**
 * rehype-raw is the markdown plugin that un-escapes raw HTML in rendered
 * content — a well-known XSS vector when feeding untrusted markdown (like
 * GitHub release bodies) into react-markdown. react-markdown's default
 * pipeline escapes HTML; this test locks that invariant so a future dep
 * addition can't silently widen the attack surface.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NEXUS_ROOT = resolve(import.meta.dirname, '../../..');

describe('markdown pipeline XSS surface', () => {
  it('rehype-raw is absent from package.json (direct and dev)', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(NEXUS_ROOT, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    assert.equal(pkg.dependencies?.['rehype-raw'], undefined,
      'rehype-raw found in dependencies');
    assert.equal(pkg.devDependencies?.['rehype-raw'], undefined,
      'rehype-raw found in devDependencies');
  });

  it('rehype-raw is absent from package-lock.json (transitive install)', () => {
    const raw = readFileSync(resolve(NEXUS_ROOT, 'package-lock.json'), 'utf8');
    // npm v3 lockfile shape: each installed package has a key
    // "node_modules/<name>" at the top-level `packages` object.
    assert.ok(
      !/"node_modules\/rehype-raw"/.test(raw),
      'rehype-raw was installed somewhere in the dependency tree',
    );
  });
});

/**
 * CI gate: every regex literal and new RegExp() string-literal call in
 * nexus/src/**\/*.{ts,tsx} must be safe-regex-clean. Unsafe patterns
 * (nested quantifiers that catastrophically backtrack) fail CI with a
 * line-precise diagnostic.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const NEXUS_ROOT = resolve(import.meta.dirname, '../../..');

interface Finding {
  file: string;
  line: number;
  col: number;
  pattern: string;
  safe: boolean;
}

describe('safe-regex audit', () => {
  it('reports zero unsafe regex patterns across nexus/src', () => {
    const scriptPath = resolve(NEXUS_ROOT, 'scripts/audit-unsafe-regex.ts');
    let stdout: string;
    try {
      stdout = execFileSync(
        process.execPath,
        ['--experimental-strip-types', scriptPath],
        { encoding: 'utf8', cwd: NEXUS_ROOT },
      );
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
      const out = String(e.stdout ?? '') + String(e.stderr ?? '');
      throw new Error(`audit script exited non-zero:\n${out}`);
    }
    const findings = JSON.parse(stdout) as Finding[];
    const unsafe = findings.filter((f) => !f.safe);
    if (unsafe.length > 0) {
      const msg = unsafe
        .map((u) => `${u.file}:${u.line}  /${u.pattern}/`)
        .join('\n');
      throw new Error(`Unsafe regex patterns found:\n${msg}`);
    }
    assert.equal(unsafe.length, 0);
  });
});

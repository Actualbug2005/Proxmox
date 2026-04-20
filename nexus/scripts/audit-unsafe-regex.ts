/**
 * Static-analysis audit: walk nexus/src/**\/*.ts{,x}, extract every regex
 * literal and every `new RegExp(stringLiteral, ...)` construction, and feed
 * the pattern through safe-regex. Emit findings as JSON on stdout. Exit 1
 * if any unsafe pattern is found — otherwise exit 0.
 *
 * Skips *.test.ts{,x} (intentional bad-regex fixtures are allowed there),
 * node_modules, and dotfile directories.
 *
 * Dynamic RegExp constructions (non-string-literal first arg) are reported
 * with pattern "<dynamic>" and safe: true so they remain visible in the
 * baseline without failing CI.
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
      const text = node.text;
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

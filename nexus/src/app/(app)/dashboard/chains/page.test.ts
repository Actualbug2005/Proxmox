import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('/dashboard/chains redirect stub', () => {
  it("redirects to '/dashboard/automation?tab=chains'", () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/automation\?tab=chains['"]\)/);
  });
});

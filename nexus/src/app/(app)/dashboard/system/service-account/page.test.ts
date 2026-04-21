import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('system/service-account redirect stub', () => {
  it("redirects to '/dashboard/cluster/access?tab=service-account'", () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/cluster\/access\?tab=service-account['"]\)/);
  });
});

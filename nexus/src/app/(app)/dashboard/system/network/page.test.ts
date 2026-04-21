import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('system/network redirect stub', () => {
  it("redirects to '/dashboard/system?tab=network'", () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/system\?tab=network['"]\)/);
  });
});

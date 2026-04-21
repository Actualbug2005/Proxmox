import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('system/certificates redirect stub', () => {
  it("redirects to '/dashboard/system?tab=certificates'", () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/system\?tab=certificates['"]\)/);
  });
});

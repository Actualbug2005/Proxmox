import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('cluster/backups redirect stub', () => {
  it("redirects to '/dashboard/cluster?tab=backups'", () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/cluster\?tab=backups['"]\)/);
  });
});

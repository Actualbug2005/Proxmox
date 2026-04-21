import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('resources page source contract', () => {
  const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

  it('references the type-filter helper', () => {
    assert.match(src, /TYPE_IDS|filterByType/);
  });

  it('reads ?type= from URL', () => {
    assert.match(src, /sp\.get\(['"]type['"]\)/);
  });

  it('renders the PoolsModal', () => {
    assert.match(src, /<PoolsModal\s/);
  });

  it('renders a "Manage pools" trigger when view-mode is pools', () => {
    assert.match(src, /viewMode === 'pools'/);
    assert.match(src, /Manage pools/);
  });
});

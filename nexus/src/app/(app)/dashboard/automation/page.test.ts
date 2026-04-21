import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('automation page', () => {
  it('exports a default React component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });

  it('exposes the three expected tab ids', async () => {
    const mod = await import('./tabs');
    assert.deepEqual(mod.TAB_IDS, ['library', 'scheduled', 'chains']);
  });
});

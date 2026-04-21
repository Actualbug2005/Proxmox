import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('chains-tab module', () => {
  it('exports ChainsTab', async () => {
    const mod = await import('./chains-tab');
    assert.equal(typeof mod.ChainsTab, 'function');
  });
});

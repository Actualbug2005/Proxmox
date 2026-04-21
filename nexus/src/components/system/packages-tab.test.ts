import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('packages-tab module', () => {
  it('exports PackagesTab', async () => {
    const mod = await import('./packages-tab');
    assert.equal(typeof mod.PackagesTab, 'function');
  });
});

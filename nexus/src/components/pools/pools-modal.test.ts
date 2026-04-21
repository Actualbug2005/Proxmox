import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('pools-modal module', () => {
  it('exports PoolsModal as a function component', async () => {
    const mod = await import('./pools-modal');
    assert.equal(typeof mod.PoolsModal, 'function');
  });
});

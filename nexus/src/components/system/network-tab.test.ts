import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('network-tab module', () => {
  it('exports NetworkTab', async () => {
    const mod = await import('./network-tab');
    assert.equal(typeof mod.NetworkTab, 'function');
  });
});

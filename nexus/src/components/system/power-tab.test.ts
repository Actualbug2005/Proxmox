import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('power-tab module', () => {
  it('exports PowerTab', async () => {
    const mod = await import('./power-tab');
    assert.equal(typeof mod.PowerTab, 'function');
  });
});

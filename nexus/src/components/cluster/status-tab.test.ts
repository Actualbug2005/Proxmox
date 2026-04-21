import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('status-tab module', () => {
  it('exports StatusTab', async () => {
    const mod = await import('./status-tab');
    assert.equal(typeof mod.StatusTab, 'function');
  });
});

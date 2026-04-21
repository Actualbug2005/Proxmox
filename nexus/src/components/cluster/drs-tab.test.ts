import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('drs-tab module', () => {
  it('exports DrsTab', async () => {
    const mod = await import('./drs-tab');
    assert.equal(typeof mod.DrsTab, 'function');
  });
});

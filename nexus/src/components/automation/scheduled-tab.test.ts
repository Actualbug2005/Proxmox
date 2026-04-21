import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('scheduled-tab module', () => {
  it('exports ScheduledTab', async () => {
    const mod = await import('./scheduled-tab');
    assert.equal(typeof mod.ScheduledTab, 'function');
  });
});

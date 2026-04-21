import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('logs-tab module', () => {
  it('exports LogsTab', async () => {
    const mod = await import('./logs-tab');
    assert.equal(typeof mod.LogsTab, 'function');
  });
});

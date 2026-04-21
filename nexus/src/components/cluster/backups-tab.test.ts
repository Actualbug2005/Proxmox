import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('backups-tab module', () => {
  it('exports BackupsTab', async () => {
    const mod = await import('./backups-tab');
    assert.equal(typeof mod.BackupsTab, 'function');
  });
});

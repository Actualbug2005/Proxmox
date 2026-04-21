import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('service-account-tab module', () => {
  it('exports ServiceAccountTab', async () => {
    const mod = await import('./service-account-tab');
    assert.equal(typeof mod.ServiceAccountTab, 'function');
  });
});

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('firewall-tab module', () => {
  it('exports FirewallTab', async () => {
    const mod = await import('./firewall-tab');
    assert.equal(typeof mod.FirewallTab, 'function');
  });
});

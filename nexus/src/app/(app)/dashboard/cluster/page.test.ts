import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('cluster shell', () => {
  it('exports a default component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });
  it('declares the four expected tab ids on the tabs module', async () => {
    const mod = await import('./tabs');
    assert.deepEqual(mod.TAB_IDS, ['status', 'drs', 'backups', 'firewall']);
  });
});

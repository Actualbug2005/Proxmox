import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('access page', () => {
  it('exports default component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });
  it('declares the six expected tab ids including service-account', async () => {
    const mod = await import('./tabs');
    assert.deepEqual(mod.TAB_IDS, ['users', 'groups', 'roles', 'realms', 'acl', 'service-account']);
  });
});

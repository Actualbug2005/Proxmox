import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('system shell', () => {
  it('exports a default component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });
  it('declares the five expected tab ids', async () => {
    const mod = await import('./tabs');
    assert.deepEqual(mod.TAB_IDS, ['power', 'network', 'logs', 'packages', 'certificates']);
  });
});

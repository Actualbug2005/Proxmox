import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('library-tab module', () => {
  it('exports LibraryTab', async () => {
    const mod = await import('./library-tab');
    assert.equal(typeof mod.LibraryTab, 'function');
  });
});

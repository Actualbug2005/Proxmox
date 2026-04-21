import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('automation page', () => {
  it('exports a default React component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });

  it('exposes the three expected tab ids', async () => {
    const mod = await import('./tabs');
    assert.deepEqual(mod.TAB_IDS, ['library', 'scheduled', 'chains']);
  });

  it('every TAB_ID has a matching render branch in page source', async () => {
    // Guards against a dropped render branch or a newly-added TAB_ID that
    // nobody wired up in AutomationPage. Pairs with the compile-time
    // exhaustiveness check inside page.tsx (which catches the type-level
    // side of the same bug class via `never`).
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    const mod = await import('./tabs');
    for (const id of mod.TAB_IDS) {
      assert.match(src, new RegExp(`tab === ['"\`]${id}['"\`]`));
    }
  });
});

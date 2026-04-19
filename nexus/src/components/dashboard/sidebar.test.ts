import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sections } from './sidebar';

describe('sidebar sections', () => {
  it('exposes a Service Account entry under the System section', () => {
    const system = sections.find((s) => s.label === 'System');
    assert.ok(system, 'expected a "System" section in the sidebar');

    const entry = system.items.find((i) => i.label === 'Service Account');
    assert.ok(entry, 'expected a "Service Account" nav entry in the System section');
    assert.equal(entry.href, '/dashboard/system/service-account');
  });

  it('does not place Service Account under Core or Infrastructure', () => {
    for (const label of ['Core', 'Infrastructure'] as const) {
      const section = sections.find((s) => s.label === label);
      assert.ok(section, `expected a "${label}" section in the sidebar`);
      const misplaced = section.items.find((i) => i.label === 'Service Account');
      assert.equal(misplaced, undefined, `"Service Account" should not appear in ${label}`);
    }
  });
});

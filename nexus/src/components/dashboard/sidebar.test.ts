import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sections } from './sidebar';

describe('sidebar sections', () => {
  it('has no dedicated Service Account entry (folded into Users & ACL)', () => {
    const all = sections.flatMap((s) => s.items);
    const sa = all.find((i) => i.label === 'Service Account');
    assert.equal(
      sa,
      undefined,
      'Service Account now lives under /dashboard/cluster/access?tab=service-account',
    );
  });

  it('exposes a Users & ACL entry that owns service-account', () => {
    const all = sections.flatMap((s) => s.items);
    const access = all.find((i) => i.href === '/dashboard/cluster/access');
    assert.ok(access, 'expected Users & ACL in the sidebar');
    assert.equal(access.label, 'Users & ACL');
  });
});

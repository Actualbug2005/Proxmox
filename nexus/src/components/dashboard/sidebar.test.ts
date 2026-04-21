import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sections } from './sidebar';

const flat = () => sections.flatMap((s) => s.items);

describe('sidebar — post-consolidation layout', () => {
  it('contains exactly 14 nav items across 3 sections', () => {
    assert.equal(sections.length, 3);
    assert.equal(flat().length, 14);
  });

  it('Core section has 6 items in the expected order', () => {
    const core = sections.find((s) => s.label === 'Core');
    assert.ok(core);
    assert.deepEqual(
      core.items.map((i) => i.href),
      [
        '/dashboard',
        '/console',
        '/dashboard/health',
        '/dashboard/tasks',
        '/dashboard/automation',
        '/dashboard/notifications',
      ],
    );
  });

  it('Infrastructure section has 4 items in the expected order', () => {
    const infra = sections.find((s) => s.label === 'Infrastructure');
    assert.ok(infra);
    assert.deepEqual(
      infra.items.map((i) => i.href),
      [
        '/dashboard/resources',
        '/dashboard/storage',
        '/dashboard/cluster',
        '/dashboard/federation',
      ],
    );
  });

  it('System section has 4 items in the expected order', () => {
    const sys = sections.find((s) => s.label === 'System');
    assert.ok(sys);
    assert.deepEqual(
      sys.items.map((i) => i.href),
      [
        '/dashboard/system',
        '/dashboard/cluster/access',
        '/dashboard/cluster/audit',
        '/dashboard/system/updates',
      ],
    );
  });

  it('does not contain any removed per-type list or sub-page routes', () => {
    const hrefs = new Set(flat().map((i) => i.href));
    for (const removed of [
      '/dashboard/nodes',
      '/dashboard/vms',
      '/dashboard/cts',
      '/dashboard/cluster/pools',
      '/dashboard/schedules',
      '/dashboard/chains',
      '/scripts',
      '/dashboard/cluster/ha',
      '/dashboard/cluster/drs',
      '/dashboard/cluster/backups',
      '/dashboard/cluster/firewall',
      '/dashboard/system/power',
      '/dashboard/system/network',
      '/dashboard/system/logs',
      '/dashboard/system/packages',
      '/dashboard/system/certificates',
      '/dashboard/system/service-account',
    ]) {
      assert.equal(hrefs.has(removed), false, `${removed} should no longer be in the sidebar`);
    }
  });
});

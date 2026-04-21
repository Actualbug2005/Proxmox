import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sections, isActive, ALL_HREFS } from './sidebar';

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

describe('sidebar — isActive longest-match disambiguation', () => {
  // Regression guard for the v0.39.0-rc1 bug where /dashboard/cluster/access
  // lit up BOTH the Cluster entry (via startsWith) and the Users & ACL
  // entry. Same pattern for /cluster/audit and /system/updates.

  it('exact /dashboard/cluster highlights only Cluster', () => {
    assert.equal(isActive('/dashboard/cluster', '/dashboard/cluster'), true);
    assert.equal(isActive('/dashboard/cluster', '/dashboard/cluster/access'), false);
    assert.equal(isActive('/dashboard/cluster', '/dashboard/cluster/audit'), false);
  });

  it('/dashboard/cluster/access highlights only Users & ACL (not Cluster)', () => {
    assert.equal(isActive('/dashboard/cluster/access', '/dashboard/cluster/access'), true);
    assert.equal(isActive('/dashboard/cluster/access', '/dashboard/cluster'), false);
  });

  it('/dashboard/cluster/audit highlights only Audit Log (not Cluster)', () => {
    assert.equal(isActive('/dashboard/cluster/audit', '/dashboard/cluster/audit'), true);
    assert.equal(isActive('/dashboard/cluster/audit', '/dashboard/cluster'), false);
  });

  it('/dashboard/system/updates highlights only Updates (not Node Settings)', () => {
    assert.equal(isActive('/dashboard/system/updates', '/dashboard/system/updates'), true);
    assert.equal(isActive('/dashboard/system/updates', '/dashboard/system'), false);
  });

  it('Cluster still lights up on tab deep-links (/dashboard/cluster?tab=firewall)', () => {
    // The query string is parsed out of pathname by Next; pathname is just
    // '/dashboard/cluster' here. So tabs inside the shell still highlight
    // the parent correctly.
    assert.equal(isActive('/dashboard/cluster', '/dashboard/cluster'), true);
  });

  it('/dashboard (root) is exact-only — sub-routes do not keep Overview active', () => {
    assert.equal(isActive('/dashboard', '/dashboard'), true);
    assert.equal(isActive('/dashboard/tasks', '/dashboard'), false);
  });

  it('every sidebar href appears in ALL_HREFS', () => {
    const declared = new Set(sections.flatMap((s) => s.items.map((i) => i.href)));
    assert.equal(ALL_HREFS.length, declared.size);
    for (const h of declared) assert.ok(ALL_HREFS.includes(h), `${h} missing from ALL_HREFS`);
  });
});

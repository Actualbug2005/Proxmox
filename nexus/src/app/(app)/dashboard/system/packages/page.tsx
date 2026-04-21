'use client';

/**
 * /dashboard/system/packages — apt package management on a node.
 *
 * Thin shell: owns the page-level `<h1>` + subtitle. The outer
 * `p-6 space-y-6` wrapper and node-picker header come from the system
 * layout; don't duplicate them here. All feature logic lives in
 * <PackagesTab/>, which is also the body Task 2 will host inside the
 * tabbed /dashboard/system shell.
 */

import { PackagesTab } from '@/components/system/packages-tab';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';

export default function PackagesPage() {
  const { node } = useSystemNode();
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-white">Packages</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          {node ? `Manage apt packages on ${node}` : 'Manage apt packages'}
        </p>
      </div>
      <PackagesTab />
    </>
  );
}

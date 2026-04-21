'use client';

/**
 * /dashboard/system/network — manage network interfaces on a node.
 *
 * Thin shell: owns the page-level `<h1>` + subtitle. The outer
 * `p-6 space-y-6` wrapper and node-picker header come from the system
 * layout; don't duplicate them here. All feature logic lives in
 * <NetworkTab/>, which is also the body Task 2 will host inside the
 * tabbed /dashboard/system shell.
 */

import { NetworkTab } from '@/components/system/network-tab';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';

export default function NetworkPage() {
  const { node } = useSystemNode();
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-white">Network</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          {node ? `Manage interfaces on ${node}` : 'Manage network interfaces'}
        </p>
      </div>
      <NetworkTab />
    </>
  );
}

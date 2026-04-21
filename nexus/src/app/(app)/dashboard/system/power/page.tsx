'use client';

/**
 * /dashboard/system/power — reboot / shutdown a node.
 *
 * Thin shell: owns the page-level `<h1>` + subtitle. The outer
 * `p-6 space-y-6` wrapper and node-picker header come from the system
 * layout; don't duplicate them here. All feature logic lives in
 * <PowerTab/>, which is also the body Task 2 will host inside the
 * tabbed /dashboard/system shell.
 */

import { PowerTab } from '@/components/system/power-tab';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';

export default function PowerPage() {
  const { node } = useSystemNode();
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-white">Power</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          {node ? `Reboot or shut down node ${node}` : 'Reboot or shut down a node'}
        </p>
      </div>
      <PowerTab />
    </>
  );
}

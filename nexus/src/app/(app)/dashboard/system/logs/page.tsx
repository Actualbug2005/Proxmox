'use client';

/**
 * /dashboard/system/logs — node journal viewer.
 *
 * Thin shell: owns the page-level `<h1>` + subtitle. The outer
 * `p-6 space-y-6` wrapper and node-picker header come from the system
 * layout; don't duplicate them here. All feature logic lives in
 * <LogsTab/>, which is also the body Task 2 will host inside the tabbed
 * /dashboard/system shell.
 */

import { LogsTab } from '@/components/system/logs-tab';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';

export default function LogsPage() {
  const { node } = useSystemNode();
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-white">Logs</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          {node ? `System journal for ${node}` : 'System journal'}
        </p>
      </div>
      <LogsTab />
    </>
  );
}

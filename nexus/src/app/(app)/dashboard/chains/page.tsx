'use client';

/**
 * /dashboard/chains — list + manage Script Chains.
 *
 * Thin shell: owns the page-level `<h1>` + subtitle `<p>` and the outer
 * padded container. All feature logic lives in <ChainsTab/>, which is
 * also the body Task 2 will host inside the tabbed /dashboard/automation
 * shell.
 */

import { ChainsTab } from '@/components/automation/chains-tab';

export default function ChainsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-fg)]">Script Chains</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Ordered sequences of Community Scripts — run ad-hoc or on a schedule.
        </p>
      </div>
      <ChainsTab />
    </div>
  );
}

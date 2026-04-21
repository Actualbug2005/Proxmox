'use client';

/**
 * /dashboard/schedules — list + manage Community-Script schedules.
 *
 * Thin shell: owns the page-level `<h1>` + subtitle `<p>` and the outer
 * padded container. All feature logic lives in <ScheduledTab/>, which is
 * also the body Task 2 will host inside the tabbed /dashboard/automation
 * shell.
 */

import { ScheduledTab } from '@/components/automation/scheduled-tab';

export default function SchedulesPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-fg)]">Scheduled Jobs</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Community scripts that run on a cadence.
        </p>
      </div>
      <ScheduledTab />
    </div>
  );
}

'use client';

import { Sliders } from 'lucide-react';
import { DrsTab } from '@/components/cluster/drs-tab';

/**
 * Thin shell for the legacy /dashboard/cluster/drs route. Owns the page
 * chrome (<h1>, description) that the tab body deliberately does NOT render
 * — this keeps `DrsTab` safe to mount inside the future /dashboard/cluster
 * tabbed shell without double-stacking a heading (the Plan A Library
 * regression lesson applied).
 */
export default function Page() {
  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
          <Sliders className="w-5 h-5 text-[var(--color-fg-muted)]" />
          Auto-DRS
        </h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          Distributed Resource Scheduler. Watches cluster pressure and
          migrates a single guest per tick when a node is clearly hotter
          than the cluster mean. Dry-run mode emits events via the
          notification engine so you can see what it <em>would</em> have
          done before flipping to Enabled.
        </p>
      </header>
      <DrsTab />
    </div>
  );
}

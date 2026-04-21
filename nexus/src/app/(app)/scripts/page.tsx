'use client';

/**
 * /scripts — Community Scripts route.
 *
 * Thin shell: owns the page-level fullscreen height container so the
 * two-pane body can lay itself out under the sticky app header. All
 * feature logic lives in <LibraryTab/>, which is also the body Task 2
 * will host inside the tabbed /dashboard/automation shell.
 */

import { LibraryTab } from '@/components/automation/library-tab';

export default function ScriptsPage() {
  return (
    <div className="h-[calc(100dvh-theme(spacing.16))] flex flex-col">
      <LibraryTab />
    </div>
  );
}

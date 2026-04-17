/**
 * Central registration — imports every widget component and registers
 * it against a stable id. Importing this module once at app startup
 * (done by the dashboard page) populates the registry before any
 * BentoGrid attempts to look widgets up.
 *
 * Keeping registration here (not per-widget file side-effect) makes
 * tree-shaking predictable and keeps the set of available widgets
 * grep-able in one place.
 */

import { registerWidget } from './registry.ts';
import { ClusterSummaryWidget } from '@/components/widgets/cluster-summary';
import { NodeRosterWidget } from '@/components/widgets/node-roster';
import { RecentTasksWidget } from '@/components/widgets/recent-tasks';
import { PressureSummaryWidget } from '@/components/widgets/pressure-summary';
import { StorageExhaustionWidget } from '@/components/widgets/storage-exhaustion';
import { TopOffendersWidget } from '@/components/widgets/top-offenders';
import { RecentFailuresWidget } from '@/components/widgets/recent-failures';
import { GuestTroubleWidget } from '@/components/widgets/guest-trouble';

let registered = false;

export function registerAllWidgets(): void {
  if (registered) return;
  registered = true;

  registerWidget({
    id: 'cluster-summary',
    title: 'Cluster summary',
    defaultSpan: { cols: 2, rows: 1 },
    Component: ClusterSummaryWidget,
  });
  registerWidget({
    id: 'node-roster',
    title: 'Nodes',
    defaultSpan: { cols: 2, rows: 2 },
    Component: NodeRosterWidget,
  });
  registerWidget({
    id: 'recent-tasks',
    title: 'Recent tasks',
    defaultSpan: { cols: 2, rows: 2 },
    Component: RecentTasksWidget,
  });
  registerWidget({
    id: 'pressure-summary',
    title: 'Cluster pressure',
    defaultSpan: { cols: 2, rows: 1 },
    Component: PressureSummaryWidget,
  });
  registerWidget({
    id: 'storage-exhaustion',
    title: 'Storage exhaustion',
    defaultSpan: { cols: 2, rows: 2 },
    Component: StorageExhaustionWidget,
  });
  registerWidget({
    id: 'top-offenders',
    title: 'Top offenders',
    defaultSpan: { cols: 2, rows: 2 },
    Component: TopOffendersWidget,
  });
  registerWidget({
    id: 'recent-failures',
    title: 'Recent failures',
    defaultSpan: { cols: 2, rows: 2 },
    Component: RecentFailuresWidget,
  });
  registerWidget({
    id: 'guest-trouble',
    title: 'Guests needing attention',
    defaultSpan: { cols: 2, rows: 2 },
    Component: GuestTroubleWidget,
  });
}

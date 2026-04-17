'use client';

/**
 * RecentTasks widget — thin shell around the existing TaskList.
 *
 * TaskList already self-fetches via useClusterTasks and renders its own
 * card shell; wrapping lets the widget registry treat it as a first
 * class citizen without duplicating its render logic.
 */

import { TaskList } from '@/components/dashboard/task-list';

export function RecentTasksWidget() {
  return (
    <div className="h-full">
      <TaskList />
    </div>
  );
}

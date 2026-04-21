import type { TabItem } from '@/components/dashboard/tab-bar';

export const TAB_IDS = ['library', 'scheduled', 'chains'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TABS: readonly TabItem<TabId>[] = [
  { id: 'library',   label: 'Library'   },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'chains',    label: 'Chains'    },
];

export function isTabId(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

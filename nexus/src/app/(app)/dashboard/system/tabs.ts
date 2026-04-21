import type { TabItem } from '@/components/dashboard/tab-bar';

export const TAB_IDS = ['power', 'network', 'logs', 'packages', 'certificates'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TABS: readonly TabItem<TabId>[] = [
  { id: 'power',        label: 'Power'        },
  { id: 'network',      label: 'Network'      },
  { id: 'logs',         label: 'Logs'         },
  { id: 'packages',     label: 'Packages'     },
  { id: 'certificates', label: 'Certificates' },
];

export function isTab(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

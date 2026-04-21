import type { TabItem } from '@/components/dashboard/tab-bar';

export const TAB_IDS = ['status', 'drs', 'backups', 'firewall'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TABS: readonly TabItem<TabId>[] = [
  { id: 'status',   label: 'HA & Status' },
  { id: 'drs',      label: 'Auto-DRS'    },
  { id: 'backups',  label: 'Backups'     },
  { id: 'firewall', label: 'Firewall'    },
];

export function isTab(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

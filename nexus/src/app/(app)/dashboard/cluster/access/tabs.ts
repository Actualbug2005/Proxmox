import type { TabItem } from '@/components/dashboard/tab-bar';

export const TAB_IDS = ['users', 'groups', 'roles', 'realms', 'acl', 'service-account'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TABS: readonly TabItem<TabId>[] = [
  { id: 'users',           label: 'Users'           },
  { id: 'groups',          label: 'Groups'          },
  { id: 'roles',           label: 'Roles'           },
  { id: 'realms',          label: 'Realms'          },
  { id: 'acl',             label: 'ACL'             },
  { id: 'service-account', label: 'Service Account' },
];

export function isTabId(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

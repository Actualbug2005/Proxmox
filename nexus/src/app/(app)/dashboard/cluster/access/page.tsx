'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { TabBar } from '@/components/dashboard/tab-bar';
import { UsersTab } from '@/components/access/users-tab';
import { GroupsTab } from '@/components/access/groups-tab';
import { RolesTab } from '@/components/access/roles-tab';
import { RealmsTab } from '@/components/access/realms-tab';
import { ACLTab } from '@/components/access/acl-tab';
import { ServiceAccountTab } from '@/components/access/service-account-tab';
import { TABS, isTabId, type TabId } from './tabs';

export default function AccessPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get('tab');
  const tab: TabId = isTabId(raw) ? raw : 'users';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    router.replace(`/dashboard/cluster/access?${next.toString()}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Users &amp; ACL</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Users, groups, roles, realms, ACL entries, and the Nexus service account.
        </p>
      </div>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'users'           && <UsersTab />}
      {tab === 'groups'          && <GroupsTab />}
      {tab === 'roles'           && <RolesTab />}
      {tab === 'realms'          && <RealmsTab />}
      {tab === 'acl'             && <ACLTab />}
      {tab === 'service-account' && <ServiceAccountTab />}
    </div>
  );
}

// Compile-time exhaustiveness guard — if a new id is added to TAB_IDS
// without a matching `tab === '<id>'` render branch, Exclude returns
// the new member (non-never), the conditional resolves to `false`,
// and assigning `true` to it fails at type-check time.
const _exhaustiveTabRender: Exclude<TabId, 'users' | 'groups' | 'roles' | 'realms' | 'acl' | 'service-account'> extends never ? true : false = true;
void _exhaustiveTabRender;

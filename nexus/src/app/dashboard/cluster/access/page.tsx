'use client';

import { useState } from 'react';
import { TabBar } from '@/components/dashboard/tab-bar';
import { UsersTab } from '@/components/access/users-tab';
import { GroupsTab } from '@/components/access/groups-tab';
import { RolesTab } from '@/components/access/roles-tab';
import { RealmsTab } from '@/components/access/realms-tab';
import { ACLTab } from '@/components/access/acl-tab';

type Tab = 'users' | 'groups' | 'roles' | 'realms' | 'acl';

export default function AccessPage() {
  const [tab, setTab] = useState<Tab>('users');
  const tabs = [
    { id: 'users' as const, label: 'Users' },
    { id: 'groups' as const, label: 'Groups' },
    { id: 'roles' as const, label: 'Roles' },
    { id: 'realms' as const, label: 'Realms' },
    { id: 'acl' as const, label: 'ACL' },
  ];
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Users & ACL</h1>
        <p className="text-sm text-zinc-500">Users, groups, roles, realms, and access control entries</p>
      </div>
      <TabBar tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'users' && <UsersTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'realms' && <RealmsTab />}
      {tab === 'acl' && <ACLTab />}
    </div>
  );
}

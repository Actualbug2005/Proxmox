'use client';

import { useState } from 'react';
import { TabBar } from '@/components/dashboard/tab-bar';
import { FirewallRulesTab } from '@/components/firewall/firewall-rules-tab';
import { FirewallOptionsTab } from '@/components/firewall/firewall-options-tab';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Layers } from 'lucide-react';

type Tab = 'rules' | 'options' | 'aliases' | 'ipsets' | 'groups';

export default function ClusterFirewallPage() {
  const [tab, setTab] = useState<Tab>('rules');

  const tabs = [
    { id: 'rules' as const, label: 'Rules' },
    { id: 'options' as const, label: 'Options' },
    { id: 'aliases' as const, label: 'Aliases', disabled: true },
    { id: 'ipsets' as const, label: 'IPSets', disabled: true },
    { id: 'groups' as const, label: 'Security Groups', disabled: true },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Firewall</h1>
        <p className="text-sm text-gray-500">Datacenter-scope firewall rules and options</p>
      </div>

      <TabBar tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'rules' && <FirewallRulesTab scope={{ kind: 'cluster' }} />}
      {tab === 'options' && <FirewallOptionsTab scope={{ kind: 'cluster' }} />}
      {(tab === 'aliases' || tab === 'ipsets' || tab === 'groups') && (
        <EmptyState
          icon={Layers}
          title="Coming in a follow-up"
          description="Aliases, IPSets, and Security Groups will ship in a later sprint. Use Rules + Options for now."
        />
      )}
    </div>
  );
}

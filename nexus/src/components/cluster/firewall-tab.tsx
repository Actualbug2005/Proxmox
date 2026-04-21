'use client';

/**
 * Datacenter-scope firewall tab body.
 *
 * Extracted from `src/app/(app)/dashboard/cluster/firewall/page.tsx` for
 * the Plan C Task 2 tabbed shell. The old /dashboard/cluster/firewall
 * route keeps the page-level chrome (outer `p-6 space-y-6` + `<h1>`) and
 * mounts this component.
 *
 * Internal sub-tabs (`rules | options | aliases | ipsets | groups`) moved
 * from local `useState` to URL-driven `?sub=<id>` so deep-links like
 * `/dashboard/cluster?tab=firewall&sub=options` work once Task 2 lands.
 */

import { useSearchParams, useRouter } from 'next/navigation';
import { TabBar } from '@/components/dashboard/tab-bar';
import { FirewallRulesTab } from '@/components/firewall/firewall-rules-tab';
import { FirewallOptionsTab } from '@/components/firewall/firewall-options-tab';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Layers } from 'lucide-react';

type Sub = 'rules' | 'options' | 'aliases' | 'ipsets' | 'groups';
const SUBS = ['rules', 'options', 'aliases', 'ipsets', 'groups'] as const;
function isSub(v: string | null): v is Sub {
  return !!v && (SUBS as readonly string[]).includes(v);
}

export function FirewallTab() {
  const sp = useSearchParams();
  const router = useRouter();
  const sub: Sub = isSub(sp.get('sub')) ? (sp.get('sub') as Sub) : 'rules';
  const setSub = (id: Sub) => {
    const next = new URLSearchParams(sp);
    next.set('sub', id);
    router.replace(`?${next.toString()}`);
  };

  const tabs = [
    { id: 'rules' as const, label: 'Rules' },
    { id: 'options' as const, label: 'Options' },
    { id: 'aliases' as const, label: 'Aliases', disabled: true },
    { id: 'ipsets' as const, label: 'IPSets', disabled: true },
    { id: 'groups' as const, label: 'Security Groups', disabled: true },
  ];

  return (
    <div className="space-y-6">
      <TabBar tabs={tabs} value={sub} onChange={setSub} />

      {sub === 'rules' && <FirewallRulesTab scope={{ kind: 'cluster' }} />}
      {sub === 'options' && <FirewallOptionsTab scope={{ kind: 'cluster' }} />}
      {(sub === 'aliases' || sub === 'ipsets' || sub === 'groups') && (
        <EmptyState
          icon={Layers}
          title="Coming in a follow-up"
          description="Aliases, IPSets, and Security Groups will ship in a later sprint. Use Rules + Options for now."
        />
      )}
    </div>
  );
}

'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Network } from 'lucide-react';
import { TabBar } from '@/components/dashboard/tab-bar';
import { StatusTab } from '@/components/cluster/status-tab';
import { DrsTab } from '@/components/cluster/drs-tab';
import { BackupsTab } from '@/components/cluster/backups-tab';
import { FirewallTab } from '@/components/cluster/firewall-tab';
import { TABS, isTab, type TabId } from './tabs';

export default function ClusterPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get('tab');
  const tab: TabId = isTab(raw) ? raw : 'status';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    next.delete('sub'); // drop sub-tab state when switching top-level tab
    router.replace(`/dashboard/cluster?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
          <Network className="w-5 h-5 text-[var(--color-fg-muted)]" />
          Cluster
        </h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          High-availability resources, Auto-DRS policy, cluster-wide backups, and firewall rules.
        </p>
      </header>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'status'   && <StatusTab   />}
      {tab === 'drs'      && <DrsTab      />}
      {tab === 'backups'  && <BackupsTab  />}
      {tab === 'firewall' && <FirewallTab />}
    </div>
  );
}

// Compile-time exhaustiveness guard. If a new id is added to TAB_IDS without
// a matching `tab === '<id>'` branch in the render, Exclude returns the new
// member (non-never), the conditional resolves to `false`, and assigning
// `true` fails at type-check time. Matches the Plan A automation pattern.
const _exhaustiveTabRender: Exclude<TabId, 'status' | 'drs' | 'backups' | 'firewall'> extends never ? true : false = true;
void _exhaustiveTabRender;

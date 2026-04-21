'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { TabBar } from '@/components/dashboard/tab-bar';
import { LibraryTab } from '@/components/automation/library-tab';
import { ScheduledTab } from '@/components/automation/scheduled-tab';
import { ChainsTab } from '@/components/automation/chains-tab';
import { Zap } from 'lucide-react';
import { TABS, isTabId, type TabId } from './tabs';

export default function AutomationPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get('tab');
  const tab: TabId = isTabId(raw) ? raw : 'library';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    router.replace(`/dashboard/automation?${next.toString()}`);
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
          <Zap className="w-5 h-5 text-[var(--color-fg-muted)]" />
          Automation
        </h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          Community script library, scheduled runs, and multi-step chains.
        </p>
      </header>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'library'   && <LibraryTab   />}
      {tab === 'scheduled' && <ScheduledTab />}
      {tab === 'chains'    && <ChainsTab    />}
    </div>
  );
}

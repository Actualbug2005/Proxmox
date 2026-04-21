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

// Compile-time exhaustiveness guard. If a new id is added to TAB_IDS without
// a matching `tab === '<id>'` branch in the render, Exclude returns the new
// member (non-never), the conditional resolves to `false`, and assigning
// `true` to it fails at type-check time. Conditional types distribute over
// unions, which is why a naked `TabId extends …` would absorb the new case
// into the union and silently pass — Exclude-then-extends-never is the
// exhaustiveness-safe shape. Pairs with the runtime regex in page.test.ts.
const _exhaustiveTabRender: Exclude<TabId, 'library' | 'scheduled' | 'chains'> extends never ? true : false = true;
void _exhaustiveTabRender;

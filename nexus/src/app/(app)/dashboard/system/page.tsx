'use client';

/**
 * Tabbed shell for per-node system settings.
 *
 * Lives inside SystemLayout (which provides `p-6 space-y-6` + the node-picker
 * header strip via SystemNodeContext). This page only owns the page title,
 * the top-level TabBar, and the render switch — each tab body is a
 * self-contained component under /components/system that reads the active
 * node via useSystemNode().
 *
 * URL contract:
 *   ?tab=<id>   — top-level tab (defaults to 'power')
 *   ?sub=<id>   — sub-tab state, owned by Packages / Certificates internally
 *
 * Switching the top-level tab clears ?sub so leftover sub-state doesn't
 * bleed into a tab that doesn't understand it.
 */
import { useSearchParams, useRouter } from 'next/navigation';
import { Sliders } from 'lucide-react';
import { TabBar } from '@/components/dashboard/tab-bar';
import { PowerTab } from '@/components/system/power-tab';
import { NetworkTab } from '@/components/system/network-tab';
import { LogsTab } from '@/components/system/logs-tab';
import { PackagesTab } from '@/components/system/packages-tab';
import { CertificatesTab } from '@/components/system/certificates-tab';
import { TABS, isTab, type TabId } from './tabs';

export default function SystemPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get('tab');
  const tab: TabId = isTab(raw) ? raw : 'power';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    next.delete('sub'); // drop sub-tab state when switching top-level tab
    // scroll: false so the node-picker + tabbar don't jump away from the user
    router.replace(`/dashboard/system?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
          <Sliders className="w-5 h-5 text-[var(--color-fg-muted)]" />
          Node Settings
        </h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          Power, network, logs, packages, and certificates for the selected node.
        </p>
      </header>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'power'        && <PowerTab        />}
      {tab === 'network'      && <NetworkTab      />}
      {tab === 'logs'         && <LogsTab         />}
      {tab === 'packages'     && <PackagesTab     />}
      {tab === 'certificates' && <CertificatesTab />}
    </div>
  );
}

// Compile-time exhaustiveness guard. If a new id is added to TAB_IDS without
// a matching `tab === '<id>'` branch in the render, Exclude returns the new
// member (non-never), the conditional resolves to `false`, and assigning
// `true` to it fails at type-check time. Conditional types distribute over
// unions, which is why a naked `TabId extends …` would absorb the new case
// into the union and silently pass — Exclude-then-extends-never is the
// exhaustiveness-safe shape.
const _exhaustiveTabRender: Exclude<TabId, 'power' | 'network' | 'logs' | 'packages' | 'certificates'> extends never ? true : false = true;
void _exhaustiveTabRender;

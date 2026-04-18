'use client';

/**
 * Notifications page — 3-tab shell. Only the Destinations tab is
 * functional in this slice (D.2); the Rules and Recent tabs ship in
 * D.3 / D.4 respectively. Placeholder panels link forward so
 * operators landing early see what's coming.
 */
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';
import { DestinationsTab } from '@/components/notifications/destinations-tab';

type TabId = 'destinations' | 'rules' | 'recent';

const TABS: ReadonlyArray<{ value: TabId; label: string }> = [
  { value: 'destinations', label: 'Destinations' },
  { value: 'rules',        label: 'Rules'        },
  { value: 'recent',       label: 'Recent'       },
] as const;

export default function NotificationsPage() {
  const [tab, setTab] = useState<TabId>('destinations');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
            <Bell className="w-5 h-5 text-[var(--color-fg-muted)]" />
            Notifications
          </h1>
          <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
            Route Nexus operational events and cluster-pressure metric
            thresholds to webhooks, ntfy, or Discord. Backoff and
            resolve policy are per-rule configurable.
          </p>
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={TABS}
          ariaLabel="Notifications section"
        />
      </header>

      {tab === 'destinations' && <DestinationsTab />}

      {tab === 'rules' && (
        <div className="studio-card p-10 text-center">
          <p className="text-sm text-[var(--color-fg-faint)]">
            Rules editor arrives in the next release. In the meantime, a
            rule can be hand-seeded into{' '}
            <code className="text-xs">$NEXUS_DATA_DIR/notifications.json</code>{' '}
            and will fire on the next event that matches.
          </p>
        </div>
      )}

      {tab === 'recent' && (
        <div className="studio-card p-10 text-center">
          <p className="text-sm text-[var(--color-fg-faint)]">
            Recent-dispatch viewer arrives in the next release. Until
            then, watch{' '}
            <code className="text-xs">journalctl -u nexus -f</code>{' '}
            for the{' '}
            <code className="text-xs">event=notification_dispatch_failed</code>{' '}
            line.
          </p>
        </div>
      )}
    </div>
  );
}

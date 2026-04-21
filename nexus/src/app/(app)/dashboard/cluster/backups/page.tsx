'use client';

import { BackupsTab } from '@/components/cluster/backups-tab';

export default function Page() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Backups</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">Backup archive and scheduled jobs across the cluster</p>
      </div>
      <BackupsTab />
    </div>
  );
}

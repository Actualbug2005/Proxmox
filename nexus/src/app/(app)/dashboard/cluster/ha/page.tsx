'use client';

import { StatusTab } from '@/components/cluster/status-tab';

export default function Page() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Cluster Status &amp; HA</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">Quorum, HA resources, and HA groups</p>
      </div>
      <StatusTab />
    </div>
  );
}

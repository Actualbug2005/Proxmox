'use client';

import { FirewallTab } from '@/components/cluster/firewall-tab';

export default function Page() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Firewall</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">Datacenter-scope firewall rules and options</p>
      </div>
      <FirewallTab />
    </div>
  );
}

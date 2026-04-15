'use client';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Shield } from 'lucide-react';

export default function FirewallStubPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-1">Firewall</h1>
      <p className="text-sm text-gray-500 mb-6">Datacenter-scope rules, aliases, IPSets, security groups, options</p>
      <EmptyState
        icon={Shield}
        title="Firewall management coming up next"
        description="Rules, aliases, IPSets, groups, and options tabs will appear here."
      />
    </div>
  );
}

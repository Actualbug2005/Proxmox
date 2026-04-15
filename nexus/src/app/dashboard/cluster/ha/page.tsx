'use client';

import { EmptyState } from '@/components/dashboard/empty-state';
import { HeartPulse } from 'lucide-react';

export default function HAStubPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-1">Cluster Status & HA</h1>
      <p className="text-sm text-gray-500 mb-6">Quorum, HA resources, and HA groups</p>
      <EmptyState
        icon={HeartPulse}
        title="HA view coming up next"
        description="Cluster status, HA resources, and groups will appear here."
      />
    </div>
  );
}

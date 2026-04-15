'use client';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Archive } from 'lucide-react';

export default function BackupsStubPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-1">Backups</h1>
      <p className="text-sm text-gray-500 mb-6">Backup archive and scheduled jobs across the cluster</p>
      <EmptyState
        icon={Archive}
        title="Backup management coming up next"
        description="Archive browser and Jobs editor with cron scheduling will appear here."
      />
    </div>
  );
}

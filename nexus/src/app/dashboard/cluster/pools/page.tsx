'use client';

import { EmptyState } from '@/components/dashboard/empty-state';
import { FolderTree } from 'lucide-react';

export default function PoolsStubPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-1">Pools</h1>
      <p className="text-sm text-gray-500 mb-6">Resource pools and member assignments</p>
      <EmptyState
        icon={FolderTree}
        title="Pools coming up next"
        description="Pool list, editor, and member management will appear here."
      />
    </div>
  );
}

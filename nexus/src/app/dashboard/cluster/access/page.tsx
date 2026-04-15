'use client';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Users } from 'lucide-react';

export default function AccessStubPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white mb-1">Users & ACL</h1>
      <p className="text-sm text-gray-500 mb-6">Users, groups, roles, realms, and access control</p>
      <EmptyState
        icon={Users}
        title="Access management coming up next"
        description="User, group, role, realm, and ACL CRUD will appear here."
      />
    </div>
  );
}

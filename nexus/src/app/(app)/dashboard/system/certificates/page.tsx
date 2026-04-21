'use client';

/**
 * /dashboard/system/certificates — TLS certificates + tunnel providers.
 *
 * Thin shell: owns the page-level `<h1>` + subtitle. The outer
 * `p-6 space-y-6` wrapper and node-picker header come from the system
 * layout; don't duplicate them here. All feature logic lives in
 * <CertificatesTab/>, which is also the body Task 2 will host inside
 * the tabbed /dashboard/system shell.
 */

import { CertificatesTab } from '@/components/system/certificates-tab';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';

export default function CertificatesPage() {
  const { node } = useSystemNode();
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-white">Certificates</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          {node ? `TLS certificates and tunnel providers for ${node}` : 'TLS certificates and tunnel providers'}
        </p>
      </div>
      <CertificatesTab />
    </>
  );
}

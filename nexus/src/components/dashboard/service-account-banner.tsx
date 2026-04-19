'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';

const DISMISS_KEY = 'nexus:service-account-banner-dismissed';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(DISMISS_KEY) === '1';
}

export function ServiceAccountBanner() {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  const { data } = useQuery<{ configured: boolean }>({
    queryKey: ['service-account', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/system/service-account', { credentials: 'include' });
      if (!res.ok) throw new Error('status fetch failed');
      return res.json();
    },
    staleTime: 60_000,
  });

  if (dismissed || !data || data.configured) return null;

  function onDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[var(--color-warn)]/10 border-b border-[var(--color-warn)]/20 text-sm text-[var(--color-warn)]">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <p className="flex-1">
        Background automation is not running. Configure a service account to enable DRS,
        auto-updates, and pressure monitoring.
      </p>
      <Link
        href="/dashboard/system/service-account"
        className="px-3 py-1 rounded bg-[var(--color-warn)]/20 text-[var(--color-warn)] text-xs"
      >
        Configure →
      </Link>
      <button onClick={onDismiss} aria-label="Dismiss" className="p-1">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

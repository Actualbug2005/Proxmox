'use client';

/**
 * NAS daemon status card. Two-indicator strip for smbd + nfs-kernel-server
 * on the target node. Polls /api/nas/services every 15s.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { cn } from '@/lib/utils';
import { Server } from 'lucide-react';
import type { NasProtocol, NasService } from '@/types/nas';

interface Props {
  node: string;
}

const LABELS: Record<NasProtocol, { title: string; unit: string }> = {
  smb: { title: 'SMB', unit: 'smbd' },
  nfs: { title: 'NFS', unit: 'nfs-kernel-server' },
};

function dotClass(status: NasService['status'] | undefined, loading: boolean): string {
  if (loading) return 'bg-gray-600 animate-pulse';
  if (status === 'running')
    return 'bg-[var(--color-ok)] shadow-[0_0_6px] shadow-emerald-400/50';
  if (status === 'not-installed') return 'bg-zinc-600';
  return 'bg-[var(--color-err)]';
}

function statusLabel(status: NasService['status'] | undefined, loading: boolean): string {
  if (loading) return '…';
  if (!status) return 'unknown';
  if (status === 'not-installed') return 'not installed';
  return status;
}

function ServiceIndicator({
  protocol,
  service,
  loading,
}: {
  protocol: NasProtocol;
  service?: NasService;
  loading: boolean;
}) {
  const label = LABELS[protocol];
  // Prefer the actual matched unit when the probe reports one; fall back
  // to the canonical default so the row never goes blank.
  const displayUnit = service?.unit || label.unit;
  const notInstalled = service?.status === 'not-installed';
  const installCmd =
    protocol === 'smb' ? 'apt install samba' : 'apt install nfs-kernel-server';
  return (
    <div className="flex items-start gap-3 px-4 py-2 bg-gray-950/40 border border-[var(--color-border-subtle)] rounded-lg">
      <span
        className={cn('mt-1 w-2.5 h-2.5 rounded-full shrink-0', dotClass(service?.status, loading))}
        aria-label={statusLabel(service?.status, loading)}
      />
      <div className="min-w-0">
        <p className="text-xs font-medium text-white">{label.title}</p>
        <p className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">
          {displayUnit} · {statusLabel(service?.status, loading)}
        </p>
        {notInstalled && (
          <p className="mt-1 text-[10px] text-[var(--color-fg-faint)] font-mono">
            install with{' '}
            <code className="px-1 py-0.5 rounded bg-black/40">{installCmd}</code>
          </p>
        )}
      </div>
    </div>
  );
}

export function NasServicesCard({ node }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['nas-services', node],
    queryFn: () => api.nas.getServices(node),
    enabled: !!node,
    refetchInterval: POLL_INTERVALS.services,
  });

  // Index by protocol so render is O(1) per indicator — avoids re-scanning
  // the array on every paint.
  const byProtocol = useMemo(() => {
    const map: Partial<Record<NasProtocol, NasService>> = {};
    for (const s of data ?? []) map[s.protocol] = s;
    return map;
  }, [data]);

  return (
    <div className="studio-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Server className="w-4 h-4 text-[var(--color-fg-subtle)]" />
        <h3 className="text-sm font-semibold text-white">NAS Services</h3>
        <span className="text-xs text-[var(--color-fg-subtle)]">· {node}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ServiceIndicator protocol="smb" service={byProtocol.smb} loading={isLoading} />
        <ServiceIndicator protocol="nfs" service={byProtocol.nfs} loading={isLoading} />
      </div>
    </div>
  );
}

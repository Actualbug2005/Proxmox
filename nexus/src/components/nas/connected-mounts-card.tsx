'use client';

/**
 * "Connected mounts" card — shows CIFS / NFS exports the PVE host is
 * CONSUMING as a client. Sister to NasServicesCard / NasSharesTable
 * which show what this host serves; this one shows what it eats.
 *
 * Polls /api/nas/client-mounts. Empty list renders a friendly empty
 * state rather than an error so a clean install doesn't show a red
 * banner.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2, Network } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { readError } from '@/lib/create-csrf-mutation';
import type { NasClientMount } from '@/types/nas';

interface Props {
  node: string;
}

interface ClientMountsResponse {
  mounts: NasClientMount[];
}

async function fetchClientMounts(node: string): Promise<NasClientMount[]> {
  const res = await fetch(
    `/api/nas/client-mounts?node=${encodeURIComponent(node)}`,
    { credentials: 'same-origin' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as ClientMountsResponse;
  return body.mounts;
}

const FS_LABEL: Record<NasClientMount['fsType'], string> = {
  cifs: 'CIFS',
  nfs: 'NFS',
  nfs4: 'NFS4',
};

export function ConnectedMountsCard({ node }: Props) {
  const { data: mounts, isLoading, error } = useQuery({
    queryKey: ['nas-client-mounts', node],
    queryFn: () => fetchClientMounts(node),
    enabled: !!node,
    refetchInterval: POLL_INTERVALS.services,
  });

  return (
    <div className="studio-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Network className="w-4 h-4 text-[var(--color-fg-subtle)]" />
        <h3 className="text-sm font-semibold text-white">Connected mounts</h3>
        <span className="text-xs text-[var(--color-fg-subtle)]">
          · {node} (incoming CIFS / NFS as a client)
        </span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-16">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--color-fg-subtle)]" />
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--color-err)]">
          Failed to read mount table: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {!isLoading && !error && (mounts?.length ?? 0) === 0 && (
        <p className="text-xs text-[var(--color-fg-faint)]">
          No CIFS or NFS mounts on {node}.
        </p>
      )}

      {!isLoading && (mounts?.length ?? 0) > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-fg-subtle)]">
              <th className="text-left px-3 py-2 font-medium w-16">Type</th>
              <th className="text-left px-3 py-2 font-medium">Server</th>
              <th className="text-left px-3 py-2 font-medium">Share</th>
              <th className="text-left px-3 py-2 font-medium">Mountpoint</th>
              <th className="text-left px-3 py-2 font-medium w-20">Access</th>
            </tr>
          </thead>
          <tbody>
            {mounts?.map((m) => (
              <tr key={m.mountpoint} className="border-b border-zinc-800/40">
                <td className="px-3 py-2">
                  <Badge variant={m.fsType === 'cifs' ? 'info' : 'warning'}>
                    {FS_LABEL[m.fsType]}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-[var(--color-fg-secondary)]">
                  {m.server || '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[var(--color-fg-secondary)] break-all">
                  {m.shareName || m.source}
                </td>
                <td className="px-3 py-2 font-mono text-[var(--color-fg-muted)] break-all">
                  {m.mountpoint}
                </td>
                <td className="px-3 py-2 text-[var(--color-fg-muted)]">
                  {m.readOnly ? 'Read-only' : 'Read/Write'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

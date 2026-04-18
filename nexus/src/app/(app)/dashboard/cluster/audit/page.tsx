'use client';

/**
 * Audit Log Explorer — read-only view over the SAFE-tier forensic log.
 *
 * Design notes:
 *  - Decryption of the SECRET tier (command plaintext) is NOT available
 *    here by design. The private key lives off-box; operators run
 *    `scripts/nexus-audit-decrypt.ts --entry-id <id>` when they need the
 *    full command for a specific entry. See SECURITY.md §Audit keypair.
 *  - Filters are server-side (cheap) so the table stays small even when
 *    exec.jsonl grows to hundreds of MB.
 *  - Entry IDs are rendered copyable so an operator can paste the id
 *    into the decrypt command in one gesture.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck, Copy, AlertTriangle } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import type { AuditEntriesResponse } from '@/app/api/audit/entries/route';

type EndpointFilter = 'all' | 'exec' | 'scripts.run';

function useAuditEntries(
  user: string,
  endpoint: EndpointFilter,
  node: string,
  limit: number,
) {
  return useQuery<AuditEntriesResponse, Error>({
    queryKey: ['audit', 'entries', { user, endpoint, node, limit }],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (user) qs.set('user', user);
      if (endpoint !== 'all') qs.set('endpoint', endpoint);
      if (node) qs.set('node', node);
      qs.set('limit', String(limit));
      const res = await fetch(`/api/audit/entries?${qs.toString()}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as AuditEntriesResponse;
    },
    refetchInterval: 30_000,
  });
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function exitBadge(code: number | null): React.ReactElement {
  if (code === 0) return <Badge variant="success">0</Badge>;
  if (code === null) return <Badge variant="warning">signal</Badge>;
  return <Badge variant="danger">{String(code)}</Badge>;
}

export default function AuditPage() {
  const [userFilter, setUserFilter] = useState('');
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilter>('all');
  const [nodeFilter, setNodeFilter] = useState('');
  const [limit, setLimit] = useState(200);
  const toast = useToast();

  const { data, isLoading, error } = useAuditEntries(
    userFilter.trim(),
    endpointFilter,
    nodeFilter.trim(),
    limit,
  );

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('Entry ID copied', id);
    } catch {
      toast.error('Copy failed', 'Clipboard API refused');
    }
  }

  const entries = data?.entries ?? [];
  const filtersActive = Boolean(userFilter || endpointFilter !== 'all' || nodeFilter);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">
            Audit Log
          </h1>
          <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
            Forensic metadata for every shell execution (<code className="text-xs">/api/exec</code>) and
            community-script run. Command plaintext is encrypted and readable only
            off-box via <code className="text-xs">scripts/nexus-audit-decrypt.ts</code>.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)] shrink-0 tabular font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--color-ok)]" />
          {data?.path ?? '/var/log/nexus/exec.jsonl'}
        </div>
      </header>

      {/* Filters */}
      <div className="studio-card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Filter label="User">
          <input
            type="text"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="root@pam"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50"
          />
        </Filter>
        <Filter label="Endpoint">
          <select
            value={endpointFilter}
            onChange={(e) => setEndpointFilter(e.target.value as EndpointFilter)}
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
          >
            <option value="all">All</option>
            <option value="exec">/api/exec</option>
            <option value="scripts.run">Script runs</option>
          </select>
        </Filter>
        <Filter label="Node">
          <input
            type="text"
            value={nodeFilter}
            onChange={(e) => setNodeFilter(e.target.value)}
            placeholder="pve"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50"
          />
        </Filter>
        <Filter label="Limit">
          <select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
          >
            {[50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Filter>
      </div>

      {/* Summary */}
      {data && (
        <div className="flex items-center justify-between text-xs text-[var(--color-fg-subtle)]">
          <span className="tabular font-mono">
            Showing {entries.length.toLocaleString()}
            {data.truncated && ` of ${data.total.toLocaleString()}`} entries
            {filtersActive && ' (filtered)'}
          </span>
          {data.truncated && (
            <span className="flex items-center gap-1 text-[var(--color-warn)]">
              <AlertTriangle className="w-3 h-3" />
              more matches exceed limit — narrow the filter or raise the cap
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="studio-card overflow-hidden">
        {isLoading && (
          <div className="p-8 flex items-center justify-center text-[var(--color-fg-subtle)]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        {error && (
          <div className="p-6 text-sm text-[var(--color-err)]">
            {error.message}
          </div>
        )}
        {!isLoading && !error && entries.length === 0 && (
          <div className="p-8 text-center text-sm text-[var(--color-fg-faint)]">
            No entries match the current filter.
          </div>
        )}
        {!isLoading && !error && entries.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-widest">
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Node</th>
                <th className="text-left px-4 py-3 font-medium">Endpoint</th>
                <th className="text-right px-4 py-3 font-medium">Cmd len</th>
                <th className="text-right px-4 py-3 font-medium">Duration</th>
                <th className="text-center px-4 py-3 font-medium">Exit</th>
                <th className="text-left px-4 py-3 font-medium">Entry ID</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className={cn(
                    'border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-overlay)]/50 transition',
                    e.exitCode !== 0 && 'bg-[var(--color-err)]/5',
                  )}
                >
                  <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)] tabular font-mono whitespace-nowrap">
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-fg-secondary)]">{e.user}</td>
                  <td className="px-4 py-3 text-[var(--color-fg-secondary)] font-mono text-xs">{e.node}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{e.endpoint}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular font-mono text-xs text-[var(--color-fg-subtle)]">
                    {formatBytes(e.cmd_len)}
                  </td>
                  <td className="px-4 py-3 text-right tabular font-mono text-xs text-[var(--color-fg-subtle)]">
                    {formatMs(e.durationMs)}
                  </td>
                  <td className="px-4 py-3 text-center">{exitBadge(e.exitCode)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => copyId(e.id)}
                      className="flex items-center gap-1.5 text-xs text-[var(--color-fg-faint)] hover:text-[var(--color-fg)] transition font-mono"
                      title="Copy entry ID — paste into nexus-audit-decrypt.ts --entry-id"
                    >
                      <code>{e.id.slice(0, 12)}…</code>
                      <Copy className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-[var(--color-fg-faint)]">
        To read a command&rsquo;s plaintext, copy its entry ID and run
        {' '}<code className="font-mono text-[var(--color-fg-subtle)]">
          node --experimental-strip-types scripts/nexus-audit-decrypt.ts
          --key ~/keys/audit-private.pem --entry-id &lt;id&gt;
          /var/log/nexus/exec-commands.enc.jsonl
        </code>{' '}
        on a machine that holds the private audit key.
      </p>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-[var(--color-fg-subtle)] block mb-1.5 uppercase tracking-widest">
        {label}
      </label>
      {children}
    </div>
  );
}

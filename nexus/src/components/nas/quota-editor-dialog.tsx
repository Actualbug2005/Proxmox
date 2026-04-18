'use client';

/**
 * Per-share quota editor.
 *
 * Reads /api/nas/quotas to show current user + group quotas, PATCHes
 * individual rows via POST to the same path. When the filesystem has
 * quotas disabled the GET returns 409; we render an actionable hint
 * ("ssh in and run quotaon") instead of a blank table.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Plus, Trash2, X } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { readCsrfCookie } from '@/lib/proxmox-client';
import type { QuotaEntry, QuotaReport } from '@/types/nas';

interface Props {
  node: string;
  shareId: string;
  shareName: string;
  onClose: () => void;
}

type QuotasResp = QuotaReport | { error: string };

async function fetchQuotas(node: string, shareId: string): Promise<QuotaReport> {
  const res = await fetch(
    `/api/nas/quotas?node=${encodeURIComponent(node)}&id=${encodeURIComponent(shareId)}`,
    { credentials: 'same-origin' },
  );
  const body = (await res.json()) as QuotasResp;
  if (!res.ok) {
    const err = Object.assign(
      new Error((body as { error?: string }).error ?? `HTTP ${res.status}`),
      { status: res.status },
    );
    throw err;
  }
  return body as QuotaReport;
}

/** Parse "10G" / "512M" / "" into bytes. Empty / 0 means no limit. */
function parseSize(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '' || trimmed === '0') return 0;
  const m = /^(\d+(?:\.\d+)?)\s*([KMGTP]?)B?$/i.exec(trimmed);
  if (!m) return null;
  const n = Number(m[1]);
  const suffix = m[2]?.toUpperCase() ?? '';
  const mult: Record<string, number> = {
    '':  1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  };
  if (!(suffix in mult)) return null;
  return Math.round(n * mult[suffix]);
}

export function QuotaEditorDialog({ node, shareId, shareName, onClose }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{
    kind: 'user' | 'group';
    name: string;
    soft: string;
    hard: string;
  }>({ kind: 'user', name: '', soft: '', hard: '' });

  const { data: report, error, isLoading } = useQuery<QuotaReport, Error & { status?: number }>({
    queryKey: ['nas-quotas', node, shareId],
    queryFn: () => fetchQuotas(node, shareId),
  });

  const setMutation = useMutation({
    mutationFn: async (vars: {
      kind: 'user' | 'group';
      name: string;
      softBytes: number;
      hardBytes: number;
    }) => {
      const csrf = readCsrfCookie();
      const res = await fetch('/api/nas/quotas', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
        body: JSON.stringify({ node, id: shareId, ...vars }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nas-quotas', node, shareId] });
    },
  });

  function applyDraft() {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(draft.name)) {
      toast.error('Invalid name', 'Users/groups must be 1..64 chars of [A-Za-z0-9._-].');
      return;
    }
    const soft = parseSize(draft.soft);
    const hard = parseSize(draft.hard);
    if (soft === null || hard === null) {
      toast.error('Invalid size', 'Use forms like 10G, 512M, or 0 to clear.');
      return;
    }
    if (soft > 0 && hard > 0 && soft > hard) {
      toast.error('Invalid range', 'Soft limit must not exceed hard limit.');
      return;
    }
    setMutation.mutate(
      { kind: draft.kind, name: draft.name, softBytes: soft, hardBytes: hard },
      {
        onSuccess: () => {
          toast.success('Quota updated', `${draft.kind} ${draft.name}`);
          setDraft((d) => ({ ...d, name: '', soft: '', hard: '' }));
        },
        onError: (err) => {
          toast.error('Quota update failed', err instanceof Error ? err.message : String(err));
        },
      },
    );
  }

  function clearRow(entry: QuotaEntry) {
    setMutation.mutate(
      { kind: entry.kind, name: entry.name, softBytes: 0, hardBytes: 0 },
      {
        onSuccess: () =>
          toast.success('Quota cleared', `${entry.kind} ${entry.name}`),
        onError: (err) =>
          toast.error('Clear failed', err instanceof Error ? err.message : String(err)),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-[var(--color-surface)] border-l border-[var(--color-border-subtle)] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
          <div>
            <h2 className="text-sm font-semibold text-white">Quotas · {shareName}</h2>
            <p className="text-xs text-[var(--color-fg-subtle)]">
              Per-user and per-group block quotas on the share&apos;s filesystem.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isLoading && (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
            </div>
          )}

          {error && error.status === 409 && (
            <div className="flex items-start gap-2 p-3 bg-[var(--color-warn)]/10 border border-[var(--color-warn)]/20 rounded-lg text-xs text-[var(--color-warn)]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Quotas aren&apos;t enabled on this filesystem. SSH into {node} and run
                <code className="mx-1 px-1 py-0.5 rounded bg-black/30 font-mono">
                  quotaon -uvg &lt;mountpoint&gt;
                </code>
                before editing here.
              </span>
            </div>
          )}

          {error && error.status !== 409 && (
            <div className="flex items-start gap-2 p-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg text-xs text-[var(--color-err)]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error.message}</span>
            </div>
          )}

          {report && (
            <>
              <section>
                <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-2">
                  Add / update
                </h3>
                <div className="grid grid-cols-[90px_1fr_1fr_1fr_auto] gap-2 items-center">
                  <select
                    value={draft.kind}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, kind: e.target.value as 'user' | 'group' }))
                    }
                    className="px-2 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-md text-xs text-[var(--color-fg-secondary)]"
                  >
                    <option value="user">User</option>
                    <option value="group">Group</option>
                  </select>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="username or group"
                    className="px-2 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-md text-xs text-[var(--color-fg-secondary)] font-mono"
                  />
                  <input
                    value={draft.soft}
                    onChange={(e) => setDraft((d) => ({ ...d, soft: e.target.value }))}
                    placeholder="soft (e.g. 10G)"
                    className="px-2 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-md text-xs text-[var(--color-fg-secondary)] font-mono"
                  />
                  <input
                    value={draft.hard}
                    onChange={(e) => setDraft((d) => ({ ...d, hard: e.target.value }))}
                    placeholder="hard (e.g. 12G)"
                    className="px-2 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-md text-xs text-[var(--color-fg-secondary)] font-mono"
                  />
                  <button
                    onClick={applyDraft}
                    disabled={setMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium disabled:opacity-40"
                  >
                    {setMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    Apply
                  </button>
                </div>
                <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
                  Enter 0 to clear a limit. Sizes accept K / M / G / T / P suffixes (1024-based).
                </p>
              </section>

              <QuotaTable title="Users" entries={report.users} onClear={clearRow} />
              <QuotaTable title="Groups" entries={report.groups} onClear={clearRow} />

              <p className="text-[10px] text-[var(--color-fg-faint)]">
                Device: <code className="font-mono">{report.device || '—'}</code>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuotaTable({
  title,
  entries,
  onClear,
}: {
  title: string;
  entries: QuotaEntry[];
  onClear: (e: QuotaEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <section>
        <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-2">
          {title}
        </h3>
        <p className="text-xs text-[var(--color-fg-faint)]">No {title.toLowerCase()} quotas.</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] mb-2">
        {title}
      </h3>
      <table className="w-full text-xs tabular">
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-fg-subtle)]">
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-right px-3 py-2 font-medium">Used</th>
            <th className="text-right px-3 py-2 font-medium">Soft</th>
            <th className="text-right px-3 py-2 font-medium">Hard</th>
            <th className="text-right px-3 py-2 font-medium w-10"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.kind}-${e.name}`} className="border-b border-zinc-800/40">
              <td className="px-3 py-2 font-mono text-[var(--color-fg-secondary)]">{e.name}</td>
              <td className="px-3 py-2 text-right text-[var(--color-fg-muted)]">{formatBytes(e.usedBytes)}</td>
              <td className="px-3 py-2 text-right text-[var(--color-fg-muted)]">
                {e.softBytes === 0 ? '—' : formatBytes(e.softBytes)}
              </td>
              <td className="px-3 py-2 text-right text-[var(--color-fg-muted)]">
                {e.hardBytes === 0 ? '—' : formatBytes(e.hardBytes)}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => onClear(e)}
                  title="Clear quota"
                  className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-err)] hover:bg-[var(--color-err)]/10 rounded-md transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

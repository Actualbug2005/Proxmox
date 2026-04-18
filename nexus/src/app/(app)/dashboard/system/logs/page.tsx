'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';
import { Loader2, ScrollText, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseJournalLine, PRIORITY_CLASS, type Priority } from '@/lib/journal-parse';

type Mode = 'table' | 'tail';

export default function LogsPage() {
  const { node } = useSystemNode();
  const [mode, setMode] = useState<Mode>('table');
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('');
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const tailRef = useRef<HTMLPreElement>(null);

  const PAGE_SIZE = 500;

  const { data: entries, isLoading } = useQuery({
    queryKey: ['journal', node, page],
    queryFn: () => api.nodes.journal(node, { lastentries: PAGE_SIZE * page }),
    enabled: !!node && mode === 'table',
  });

  const { data: tailEntries } = useQuery({
    queryKey: ['journal', node, 'tail'],
    queryFn: () => api.nodes.journal(node, { lastentries: 100 }),
    enabled: !!node && mode === 'tail' && !paused,
    refetchInterval: POLL_INTERVALS.logs,
  });

  useEffect(() => {
    if (mode === 'tail' && !paused && tailRef.current) {
      tailRef.current.scrollTop = tailRef.current.scrollHeight;
    }
  }, [tailEntries, mode, paused]);

  const parsed = useMemo(() => (entries ?? []).map(parseJournalLine), [entries]);

  const allUnits = useMemo(
    () => [...new Set(parsed.map((p) => p.unit).filter(Boolean))].sort(),
    [parsed],
  );

  const filtered = useMemo(
    () => parsed.filter((e) => {
      if (unitFilter && e.unit !== unitFilter) return false;
      if (priorityFilter && e.priority !== priorityFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.message.toLowerCase().includes(q) && !e.unit.toLowerCase().includes(q)) return false;
      }
      return true;
    }),
    [parsed, unitFilter, priorityFilter, search],
  );

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--color-fg-subtle)] text-sm">
        Select a node to view logs.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Logs</h1>
          <p className="text-sm text-[var(--color-fg-subtle)]">System journal for {node}</p>
        </div>
        <div className="flex gap-1 bg-[var(--color-overlay)] p-1 rounded-lg">
          {(['table', 'tail'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition',
                mode === m ? 'bg-[var(--color-overlay)] text-white' : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
              )}
            >
              {m === 'table' ? 'Table' : 'Live Tail'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'table' && (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search message or unit…"
              className="flex-1 min-w-48 px-3 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
            />
            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="px-3 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
            >
              <option value="">All units</option>
              {allUnits.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | '')}
              className="px-3 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
            >
              <option value="">All priorities</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" /></div>
          ) : (
            <>
              <div className="studio-card overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)]">
                      <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium w-40">Time</th>
                      <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium w-20">Priority</th>
                      <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium w-40">Unit</th>
                      <th className="text-left px-4 py-3 text-[var(--color-fg-subtle)] font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, PAGE_SIZE * page).map((entry, i) => (
                      <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                        <td className="px-4 py-1.5 font-mono text-[var(--color-fg-subtle)] whitespace-nowrap">{entry.time || '—'}</td>
                        <td className="px-4 py-1.5">
                          <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-widest', PRIORITY_CLASS[entry.priority])}>
                            {entry.priority}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 font-mono text-[var(--color-fg-muted)] truncate max-w-[10rem]" title={entry.unit}>{entry.unit || '—'}</td>
                        <td className="px-4 py-1.5 text-[var(--color-fg-secondary)] break-all">{entry.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--color-fg-subtle)]">Showing {Math.min(filtered.length, PAGE_SIZE * page)} of {filtered.length} entries</p>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition"
                >
                  Load More
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'tail' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              placeholder="Filter by unit (e.g. pveproxy)"
              className="flex-1 px-3 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
            />
            <button
              onClick={() => setPaused((p) => !p)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition',
                paused
                  ? 'bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)]'
                  : 'bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)]',
              )}
            >
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>

          {tailEntries && tailEntries.length === 0 && !paused && (
            <div className="flex items-center gap-2 text-[var(--color-fg-subtle)] text-sm">
              <ScrollText className="w-4 h-4" />
              No entries. Check unit filter or wait for new log messages.
            </div>
          )}

          <pre
            ref={tailRef}
            className="bg-gray-950 border border-[var(--color-border-subtle)] rounded-lg p-4 text-xs text-[var(--color-fg-muted)] font-mono overflow-y-auto h-[28rem] whitespace-pre-wrap"
          >
            {(tailEntries ?? [])
              .map((raw) => parseJournalLine(raw))
              .filter((e) => !unitFilter || e.unit === unitFilter)
              .map((e) => e.raw)
              .join('\n')}
          </pre>
        </div>
      )}
    </>
  );
}

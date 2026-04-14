'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/layout';
import { Badge } from '@/components/ui/badge';
import { Loader2, ScrollText, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JournalEntry } from '@/types/proxmox';

type Mode = 'table' | 'tail';
type Priority = 'all' | 'err' | 'warning' | 'info';

const PRIORITY_VARIANTS: Record<string, 'danger' | 'warning' | 'outline'> = {
  '0': 'danger', '1': 'danger', '2': 'danger', '3': 'danger',
  emerg: 'danger', alert: 'danger', crit: 'danger', err: 'danger',
  '4': 'warning', warning: 'warning',
  '5': 'outline', '6': 'outline', '7': 'outline',
  notice: 'outline', info: 'outline', debug: 'outline',
};

const PRIORITY_LABELS: Record<string, string> = {
  '0': 'emerg', '1': 'alert', '2': 'crit', '3': 'err',
  '4': 'warn', '5': 'notice', '6': 'info', '7': 'debug',
};

function priorityLabel(p?: string) {
  return p ? (PRIORITY_LABELS[p] ?? p) : 'info';
}

function priorityVariant(p?: string): 'danger' | 'warning' | 'outline' {
  return p ? (PRIORITY_VARIANTS[p] ?? 'outline') : 'outline';
}

function matchesPriorityFilter(entry: JournalEntry, filter: Priority): boolean {
  if (filter === 'all') return true;
  const p = entry.p ?? '6';
  if (filter === 'err') return ['0','1','2','3','emerg','alert','crit','err'].includes(p);
  if (filter === 'warning') return ['0','1','2','3','4','emerg','alert','crit','err','warning'].includes(p);
  return true;
}

export default function LogsPage() {
  const { node } = useSystemNode();
  const [mode, setMode] = useState<Mode>('table');
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority>('all');
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
    queryFn: () => api.nodes.journal(node, { lastentries: 100, ...(unitFilter ? { unit: unitFilter } : {}) }),
    enabled: !!node && mode === 'tail' && !paused,
    refetchInterval: 2_000,
  });

  useEffect(() => {
    if (mode === 'tail' && !paused && tailRef.current) {
      tailRef.current.scrollTop = tailRef.current.scrollHeight;
    }
  }, [tailEntries, mode, paused]);

  const allUnits = [...new Set((entries ?? []).map((e) => e.u).filter(Boolean))] as string[];

  const filtered = (entries ?? []).filter((e) => {
    if (!matchesPriorityFilter(e, priorityFilter)) return false;
    if (unitFilter && e.u !== unitFilter) return false;
    if (search && !e.m.toLowerCase().includes(search.toLowerCase()) && !e.u?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to view logs.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Logs</h1>
          <p className="text-sm text-gray-500">System journal for {node}</p>
        </div>
        <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
          {(['table', 'tail'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition',
                mode === m ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300',
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
              className="flex-1 min-w-48 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            >
              <option value="all">All priorities</option>
              <option value="err">Errors only</option>
              <option value="warning">Warnings+</option>
            </select>
            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            >
              <option value="">All units</option>
              {allUnits.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
          ) : (
            <>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-44">Time</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-32">Unit</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-20">Priority</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, PAGE_SIZE * page).map((entry, i) => (
                      <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="px-4 py-1.5 font-mono text-gray-500 whitespace-nowrap">{entry.t}</td>
                        <td className="px-4 py-1.5 font-mono text-gray-400 truncate max-w-[8rem]">{entry.u ?? '—'}</td>
                        <td className="px-4 py-1.5">
                          <Badge variant={priorityVariant(entry.p)} className="text-xs">{priorityLabel(entry.p)}</Badge>
                        </td>
                        <td className="px-4 py-1.5 text-gray-300 break-all">{entry.m}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Showing {Math.min(filtered.length, PAGE_SIZE * page)} of {filtered.length} entries</p>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition"
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
              placeholder="Filter by unit (e.g. pveproxyd)"
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            />
            <button
              onClick={() => setPaused((p) => !p)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition',
                paused
                  ? 'bg-orange-500 hover:bg-orange-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300',
              )}
            >
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>

          {tailEntries && tailEntries.length === 0 && !paused && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <ScrollText className="w-4 h-4" />
              No entries. Check unit filter or wait for new log messages.
            </div>
          )}

          <pre
            ref={tailRef}
            className="bg-gray-950 border border-gray-800 rounded-xl p-4 text-xs text-gray-400 font-mono overflow-y-auto h-[28rem] whitespace-pre-wrap"
          >
            {(tailEntries ?? []).map((e) =>
              `${e.t}  [${(e.u ?? '').padEnd(20)}]  ${e.m}\n`
            ).join('')}
          </pre>
        </div>
      )}
    </>
  );
}

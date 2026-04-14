'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/node-context';
import { Loader2, ScrollText, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

type Mode = 'table' | 'tail';

interface ParsedEntry {
  raw: string;
  time: string;
  host: string;
  unit: string;
  message: string;
}

// Parse a journalctl text line: "Apr 14 23:06:22 pve pveproxy[12345]: message"
// Falls back gracefully if format doesn't match.
function parseEntry(raw: string): ParsedEntry {
  const m = raw.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:]+?):\s+(.*)$/);
  if (!m) return { raw, time: '', host: '', unit: '', message: raw };
  const [, time, host, unitWithPid, message] = m;
  const unit = unitWithPid.replace(/\[\d+\]$/, '');
  return { raw, time, host, unit, message };
}

export default function LogsPage() {
  const { node } = useSystemNode();
  const [mode, setMode] = useState<Mode>('table');
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
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
    refetchInterval: 2_000,
  });

  useEffect(() => {
    if (mode === 'tail' && !paused && tailRef.current) {
      tailRef.current.scrollTop = tailRef.current.scrollHeight;
    }
  }, [tailEntries, mode, paused]);

  const parsed = useMemo(() => (entries ?? []).map(parseEntry), [entries]);

  const allUnits = useMemo(
    () => [...new Set(parsed.map((p) => p.unit).filter(Boolean))].sort(),
    [parsed],
  );

  const filtered = parsed.filter((e) => {
    if (unitFilter && e.unit !== unitFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.message.toLowerCase().includes(q) && !e.unit.toLowerCase().includes(q)) return false;
    }
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
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-40">Time</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-40">Unit</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, PAGE_SIZE * page).map((entry, i) => (
                      <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="px-4 py-1.5 font-mono text-gray-500 whitespace-nowrap">{entry.time || '—'}</td>
                        <td className="px-4 py-1.5 font-mono text-gray-400 truncate max-w-[10rem]" title={entry.unit}>{entry.unit || '—'}</td>
                        <td className="px-4 py-1.5 text-gray-300 break-all">{entry.message}</td>
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
              placeholder="Filter by unit (e.g. pveproxy)"
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
            {(tailEntries ?? [])
              .map((raw) => parseEntry(raw))
              .filter((e) => !unitFilter || e.unit === unitFilter)
              .map((e) => e.raw)
              .join('\n')}
          </pre>
        </div>
      )}
    </>
  );
}

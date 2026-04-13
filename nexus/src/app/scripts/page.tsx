'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClusterResources } from '@/hooks/use-cluster';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  Code2,
  Play,
  ChevronDown,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Server,
  Info,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommunityScript } from '@/types/proxmox';

type RunStatus = 'idle' | 'running' | 'success' | 'error';

interface RunState {
  scriptSlug: string;
  status: RunStatus;
  message?: string;
  upid?: string;
}

function ScriptCard({
  script,
  onRun,
  running,
}: {
  script: CommunityScript;
  onRun: (script: CommunityScript) => void;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const typeColors: Record<string, string> = {
    ct: 'info',
    vm: 'warning',
    misc: 'outline',
    addon: 'success',
  };

  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{script.name}</h3>
            <Badge variant={(typeColors[script.type] ?? 'outline') as 'info' | 'warning' | 'outline' | 'success'}>
              {script.type.toUpperCase()}
            </Badge>
            {script.category && (
              <Badge variant="outline">{script.category}</Badge>
            )}
          </div>
          {script.description && (
            <p className="text-xs text-gray-500 line-clamp-2">{script.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={`https://github.com/community-scripts/ProxmoxVE/blob/main/ct/${script.slug}.sh`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-gray-600 hover:text-gray-300 transition"
            title="View source"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-1.5 text-gray-600 hover:text-gray-300 transition"
            title="Details"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onRun(script)}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white text-xs rounded-lg transition font-medium"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
          {script.resources && (
            <div className="grid grid-cols-3 gap-2">
              {script.resources.cpu && (
                <div className="text-xs">
                  <span className="text-gray-600">CPU:</span>{' '}
                  <span className="text-gray-400">{script.resources.cpu} cores</span>
                </div>
              )}
              {script.resources.ram && (
                <div className="text-xs">
                  <span className="text-gray-600">RAM:</span>{' '}
                  <span className="text-gray-400">{script.resources.ram} MB</span>
                </div>
              )}
              {script.resources.hdd && (
                <div className="text-xs">
                  <span className="text-gray-600">Disk:</span>{' '}
                  <span className="text-gray-400">{script.resources.hdd}</span>
                </div>
              )}
            </div>
          )}
          {script.default_credentials && (
            <div className="text-xs text-gray-500">
              Default credentials:{' '}
              <span className="text-gray-400 font-mono">
                {script.default_credentials.username ?? 'N/A'} /{' '}
                {script.default_credentials.password ?? 'N/A'}
              </span>
            </div>
          )}
          {script.notes?.length ? (
            <ul className="space-y-0.5">
              {script.notes.map((note, i) => (
                <li key={i} className="text-xs text-gray-500 flex gap-1.5">
                  <span className="text-orange-400 shrink-0">•</span>
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-gray-600 font-mono break-all">{script.scriptUrl}</p>
        </div>
      )}
    </div>
  );
}

export default function ScriptsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [runModal, setRunModal] = useState<CommunityScript | null>(null);
  const [selectedNode, setSelectedNode] = useState('');
  const [runState, setRunState] = useState<RunState | null>(null);

  const { data: resources } = useClusterResources();
  const nodes = resources?.filter((r) => r.type === 'node' && r.status === 'online') ?? [];

  const { data: scripts = [], isLoading, isError } = useQuery<CommunityScript[]>({
    queryKey: ['community-scripts'],
    queryFn: async () => {
      const res = await fetch('/api/scripts');
      if (!res.ok) throw new Error('Failed to load scripts');
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  const categories = useMemo(() => {
    const cats = new Set(scripts.map((s) => s.category).filter(Boolean));
    return ['All', ...Array.from(cats).sort()];
  }, [scripts]);

  const filtered = useMemo(() => {
    return scripts.filter((s) => {
      const matchSearch =
        !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description?.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === 'All' || s.category === categoryFilter;
      const matchType = typeFilter === 'All' || s.type === typeFilter;
      return matchSearch && matchCat && matchType;
    });
  }, [scripts, search, categoryFilter, typeFilter]);

  async function runScript(script: CommunityScript, node: string) {
    setRunState({ scriptSlug: script.slug, status: 'running' });

    try {
      const res = await fetch('/api/scripts/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node, scriptUrl: script.scriptUrl, scriptName: script.name }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Script execution failed');
      }

      const data = await res.json();
      setRunState({ scriptSlug: script.slug, status: 'success', upid: data.upid });
    } catch (err) {
      setRunState({
        scriptSlug: script.slug,
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Community Scripts</h1>
        <p className="text-sm text-gray-500">
          {scripts.length} scripts from community-scripts/ProxmoxVE
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
          <input
            type="text"
            placeholder="Search scripts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-1">
          {['All', 'ct', 'vm', 'misc', 'addon'].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition',
                typeFilter === t
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                  : 'text-gray-500 bg-gray-900 border border-gray-800 hover:text-gray-300',
              )}
            >
              {t === 'All' ? 'All types' : t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Category pills */}
      {categories.length > 2 && (
        <div className="flex gap-1.5 flex-wrap">
          {categories.slice(0, 15).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs transition',
                categoryFilter === cat
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-gray-600 hover:text-gray-400 bg-gray-900 border border-gray-800',
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading scripts from GitHub…</span>
          </div>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-sm text-red-400">Failed to load community scripts</p>
        </div>
      )}

      {/* Grid */}
      {!isLoading && !isError && (
        <>
          <p className="text-xs text-gray-600">{filtered.length} results</p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {filtered.map((script) => (
              <ScriptCard
                key={script.slug}
                script={script}
                onRun={(s) => {
                  setRunModal(s);
                  setRunState(null);
                  setSelectedNode(nodes[0]?.node ?? nodes[0]?.id ?? '');
                }}
                running={runState?.scriptSlug === script.slug && runState.status === 'running'}
              />
            ))}
          </div>
        </>
      )}

      {/* Run modal */}
      {runModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Run: {runModal.name}</h3>
              <button
                onClick={() => { setRunModal(null); setRunState(null); }}
                className="text-gray-600 hover:text-gray-300 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {runState?.status !== 'success' && runState?.status !== 'error' ? (
              <>
                <p className="text-xs text-gray-500 mb-4">
                  This will execute the install script directly on the selected node via the
                  Proxmox API.
                </p>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Target Node
                  </label>
                  <div className="relative">
                    <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <select
                      value={selectedNode}
                      onChange={(e) => setSelectedNode(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500 appearance-none"
                    >
                      {nodes.map((n) => (
                        <option key={n.id} value={n.node ?? n.id}>
                          {n.node ?? n.id}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  </div>
                </div>

                <div className="mb-4 p-3 bg-gray-800 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Command to run:</p>
                  <code className="text-xs text-orange-300 font-mono break-all">
                    bash &lt;(curl -fsSL &apos;{runModal.scriptUrl}&apos;)
                  </code>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => { setRunModal(null); setRunState(null); }}
                    className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => runScript(runModal, selectedNode)}
                    disabled={!selectedNode || runState?.status === 'running'}
                    className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white text-sm rounded-lg transition flex items-center justify-center gap-2 font-medium"
                  >
                    {runState?.status === 'running' && <Loader2 className="w-4 h-4 animate-spin" />}
                    {runState?.status === 'running' ? 'Running…' : 'Execute Script'}
                  </button>
                </div>
              </>
            ) : runState.status === 'success' ? (
              <div className="text-center py-4">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <p className="text-sm text-emerald-400 font-medium mb-1">Script started!</p>
                {runState.upid && (
                  <p className="text-xs text-gray-500 font-mono break-all">UPID: {runState.upid}</p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Check the Tasks panel for progress.
                </p>
                <button
                  onClick={() => { setRunModal(null); setRunState(null); }}
                  className="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="text-center py-4">
                <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
                <p className="text-sm text-red-400 font-medium mb-1">Execution failed</p>
                <p className="text-xs text-gray-500">{runState.message}</p>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => { setRunModal(null); setRunState(null); }}
                    className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => runScript(runModal, selectedNode)}
                    className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

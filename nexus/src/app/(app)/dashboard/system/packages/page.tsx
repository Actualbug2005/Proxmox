'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, ArrowUpCircle, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

type Tab = 'pve' | 'system';

export default function PackagesPage() {
  const { node } = useSystemNode();
  const [tab, setTab] = useState<Tab>('pve');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taskUpid, setTaskUpid] = useState('');
  const qc = useQueryClient();
  const toast = useToast();

  const { data: pvePackages, isLoading: pveLoading, refetch: refetchPve } = useQuery({
    queryKey: ['apt', 'versions', node],
    queryFn: () => api.apt.versions(node),
    enabled: !!node && tab === 'pve',
  });

  const { data: upgradable, isLoading: sysLoading, refetch: refetchSys } = useQuery({
    queryKey: ['apt', 'upgradable', node],
    queryFn: () => api.apt.upgradable(node),
    enabled: !!node,
  });

  // Map upgradable package name → new version for cross-referencing with /apt/versions
  const newVersionByPkg = new Map<string, string>();
  (upgradable ?? []).forEach((p) => newVersionByPkg.set(p.Package, p.Version));

  const refreshM = useMutation({
    mutationFn: () => api.apt.update(node),
    onSuccess: (upid) => {
      setTaskUpid(upid);
      toast.success('Refreshing apt cache', `Task ${upid.slice(0, 24)}…`);
      setTimeout(() => {
        refetchPve();
        refetchSys();
      }, 3000);
    },
    onError: (err) => toast.error('Refresh failed', err instanceof Error ? err.message : String(err)),
  });

  const installM = useMutation({
    mutationFn: (packages: string[]) => api.apt.install(node, packages),
    onSuccess: (_stdout, variables) => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['apt'] });
      const what = variables.length > 0 ? `${variables.length} package${variables.length !== 1 ? 's' : ''}` : 'full upgrade';
      toast.success(`Upgrade complete: ${what}`);
    },
    onError: (err) => toast.error('Upgrade failed', err instanceof Error ? err.message : String(err)),
  });

  const filteredSystem = (upgradable ?? []).filter(
    (p) =>
      !search ||
      p.Package.toLowerCase().includes(search.toLowerCase()) ||
      p.Description?.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleSelect = (pkg: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pkg)) {
        next.delete(pkg);
      } else {
        next.add(pkg);
      }
      return next;
    });
  };

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
        Select a node to manage packages.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Packages</h1>
          <p className="text-sm text-zinc-500">Manage apt packages on {node}</p>
        </div>
        <button
          onClick={() => refreshM.mutate()}
          disabled={refreshM.isPending}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-800 text-zinc-300 text-sm rounded-lg transition disabled:opacity-40"
        >
          {refreshM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh Cache
        </button>
      </div>

      {taskUpid && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs px-4 py-2 rounded-lg">
          Task queued: <span className="font-mono">{taskUpid}</span>
        </div>
      )}

      <div className="flex gap-1 border-b border-zinc-800/60 mt-2">
        {(['pve', 'system'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px',
              tab === t
                ? 'border-zinc-200 text-indigo-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t === 'pve' ? 'PVE Packages' : 'System Packages'}
          </button>
        ))}
      </div>

      {tab === 'pve' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-400">
              {(() => {
                const count = (pvePackages ?? []).filter((p) => newVersionByPkg.has(p.Package)).length;
                return count > 0
                  ? `${count} update${count !== 1 ? 's' : ''} available · ${pvePackages?.length ?? 0} PVE packages installed`
                  : `${pvePackages?.length ?? 0} PVE packages installed · all up to date`;
              })()}
            </p>
            <button
              onClick={() => installM.mutate([])}
              disabled={installM.isPending}
              className="flex items-center gap-2 px-3 py-1.5 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm rounded-lg transition disabled:opacity-40"
            >
              {installM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
              Upgrade All PVE
            </button>
          </div>

          {pveLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="studio-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/60">
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Package</th>
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Current</th>
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {(pvePackages ?? []).map((pkg) => {
                    const newVersion = newVersionByPkg.get(pkg.Package);
                    return (
                      <tr key={pkg.Package} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3 font-mono text-zinc-200">{pkg.Package}</td>
                        <td className="px-4 py-3 font-mono text-zinc-500 text-xs">{pkg.Version}</td>
                        <td className="px-4 py-3">
                          {newVersion ? (
                            <Badge variant="warning" className="font-mono text-xs">{newVersion}</Badge>
                          ) : (
                            <Badge variant="success" className="text-xs">current</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'system' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packages…"
              className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => installM.mutate(Array.from(selected))}
                disabled={selected.size === 0 || installM.isPending}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-indigo-400 text-sm rounded-lg transition disabled:opacity-40"
              >
                Upgrade Selected ({selected.size})
              </button>
              <button
                onClick={() => installM.mutate([])}
                disabled={installM.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm rounded-lg transition disabled:opacity-40"
              >
                {installM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                Upgrade All
              </button>
            </div>
          </div>

          {sysLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
          ) : filteredSystem.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-zinc-500 gap-2">
              <Package className="w-6 h-6" />
              <p className="text-sm">{search ? 'No matching packages' : 'All system packages up to date'}</p>
            </div>
          ) : (
            <div className="studio-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/60">
                    <th className="px-4 py-3 w-8" />
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Package</th>
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Current</th>
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Available</th>
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Section</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSystem.map((pkg) => (
                    <tr key={pkg.Package} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(pkg.Package)}
                          onChange={() => toggleSelect(pkg.Package)}
                          className="rounded border-gray-600"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-zinc-200">{pkg.Package}</td>
                      <td className="px-4 py-3 font-mono text-zinc-500 text-xs">{pkg.OldVersion}</td>
                      <td className="px-4 py-3 font-mono text-amber-400 text-xs">{pkg.Version}</td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">{pkg.Section ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

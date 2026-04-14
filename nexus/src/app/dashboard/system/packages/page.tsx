'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/node-context';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, ArrowUpCircle, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tab = 'pve' | 'system';

export default function PackagesPage() {
  const { node } = useSystemNode();
  const [tab, setTab] = useState<Tab>('pve');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taskUpid, setTaskUpid] = useState('');
  const qc = useQueryClient();

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
      setTimeout(() => {
        refetchPve();
        refetchSys();
      }, 3000);
    },
  });

  const installM = useMutation({
    mutationFn: (packages: string[]) => api.apt.install(node, packages),
    onSuccess: (upid) => {
      setTaskUpid(upid);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['apt'] });
    },
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
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to manage packages.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Packages</h1>
          <p className="text-sm text-gray-500">Manage apt packages on {node}</p>
        </div>
        <button
          onClick={() => refreshM.mutate()}
          disabled={refreshM.isPending}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition disabled:opacity-40"
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

      <div className="flex gap-1 border-b border-gray-800 mt-2">
        {(['pve', 'system'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px',
              tab === t
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {t === 'pve' ? 'PVE Packages' : 'System Packages'}
          </button>
        ))}
      </div>

      {tab === 'pve' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
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
              className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
            >
              {installM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
              Upgrade All PVE
            </button>
          </div>

          {pveLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Package</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Current</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {(pvePackages ?? []).map((pkg) => {
                    const newVersion = newVersionByPkg.get(pkg.Package);
                    return (
                      <tr key={pkg.Package} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-2.5 font-mono text-gray-200">{pkg.Package}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{pkg.Version}</td>
                        <td className="px-4 py-2.5">
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
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => installM.mutate(Array.from(selected))}
                disabled={selected.size === 0 || installM.isPending}
                className="px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-sm rounded-lg transition disabled:opacity-40"
              >
                Upgrade Selected ({selected.size})
              </button>
              <button
                onClick={() => installM.mutate([])}
                disabled={installM.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
              >
                {installM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                Upgrade All
              </button>
            </div>
          </div>

          {sysLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          ) : filteredSystem.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 gap-2">
              <Package className="w-6 h-6" />
              <p className="text-sm">{search ? 'No matching packages' : 'All system packages up to date'}</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-4 py-2.5 w-8" />
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Package</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Current</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Available</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Section</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSystem.map((pkg) => (
                    <tr key={pkg.Package} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(pkg.Package)}
                          onChange={() => toggleSelect(pkg.Package)}
                          className="rounded border-gray-600"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-200">{pkg.Package}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{pkg.OldVersion}</td>
                      <td className="px-4 py-2.5 font-mono text-orange-400 text-xs">{pkg.Version}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{pkg.Section ?? '—'}</td>
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

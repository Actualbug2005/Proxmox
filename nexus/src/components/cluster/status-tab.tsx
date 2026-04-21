'use client';

/**
 * Cluster status + HA tab body.
 *
 * Extracted from `src/app/(app)/dashboard/cluster/ha/page.tsx` so the body
 * can be hosted inside the future /dashboard/cluster tabbed shell (Plan C
 * Task 2). The old /dashboard/cluster/ha route keeps the page-level chrome
 * (outer `p-6 space-y-6` + `<h1>`) and mounts this component.
 *
 * The sub-tab state (`resources | groups | status`) used to be local
 * `useState`; it is now URL-driven via `?sub=<id>` so deep-links like
 * `/dashboard/cluster?tab=status&sub=groups` will work once the shell lands.
 * The router.replace URL is kept relative so the same pattern works from
 * BOTH the legacy /dashboard/cluster/ha route AND /dashboard/cluster.
 */

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { useToast } from '@/components/ui/toast';
import { TabBar } from '@/components/dashboard/tab-bar';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { ClusterStatusPanel } from '@/components/ha/cluster-status-panel';
import { HAResourceEditor } from '@/components/ha/ha-resource-editor';
import { HAGroupEditor } from '@/components/ha/ha-group-editor';
import { HAMigrateDialog } from '@/components/ha/ha-migrate-dialog';
import {
  HeartPulse, Plus, Trash2, Pencil, ArrowRightLeft, Shuffle, Layers, Loader2,
} from 'lucide-react';
import type { HAResource, HAGroupPublic } from '@/types/proxmox';

type Sub = 'resources' | 'groups' | 'status';
const SUBS = ['resources', 'groups', 'status'] as const;
function isSub(v: string | null): v is Sub {
  return !!v && (SUBS as readonly string[]).includes(v);
}

function stateVariant(state?: string): 'success' | 'danger' | 'warning' | 'outline' {
  if (!state) return 'outline';
  if (state.startsWith('started') || state === 'running') return 'success';
  if (state === 'error' || state === 'fence') return 'danger';
  if (state === 'stopped' || state === 'disabled' || state === 'ignored') return 'outline';
  return 'warning';
}

export function StatusTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const sp = useSearchParams();
  const router = useRouter();
  const sub: Sub = isSub(sp.get('sub')) ? (sp.get('sub') as Sub) : 'resources';
  const setSub = (id: Sub) => {
    const next = new URLSearchParams(sp);
    next.set('sub', id);
    // scroll: false — sub-tab switches shouldn't yank the page to top; the
    // old useState toggle preserved scroll, Next's router.replace defaults
    // to scroll: true.
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const { data: resources, isLoading: loadingRes } = useQuery({
    queryKey: ['ha', 'resources'],
    queryFn: () => api.ha.resources.list(),
    refetchInterval: POLL_INTERVALS.services,
  });

  const { data: groups, isLoading: loadingGroups } = useQuery({
    queryKey: ['ha', 'groups'],
    queryFn: () => api.ha.groups.list(),
    refetchInterval: POLL_INTERVALS.config,
  });

  const { data: haStatus } = useQuery({
    queryKey: ['ha', 'status', 'current'],
    queryFn: () => api.ha.status.current(),
    refetchInterval: POLL_INTERVALS.cluster,
  });

  const [editRes, setEditRes] = useState<HAResource | null>(null);
  const [showNewRes, setShowNewRes] = useState(false);
  const [deleteRes, setDeleteRes] = useState<HAResource | null>(null);
  const [migrateTarget, setMigrateTarget] = useState<{ r: HAResource; kind: 'migrate' | 'relocate' } | null>(null);

  const [editGroup, setEditGroup] = useState<HAGroupPublic | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [deleteGroup, setDeleteGroup] = useState<HAGroupPublic | null>(null);

  const deleteResM = useMutation({
    mutationFn: (r: HAResource) => api.ha.resources.delete(r.sid),
    onSuccess: () => {
      setDeleteRes(null);
      qc.invalidateQueries({ queryKey: ['ha', 'resources'] });
      toast.success('Resource removed from HA management', 'The guest is unchanged.');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const deleteGroupM = useMutation({
    mutationFn: (g: HAGroupPublic) => api.ha.groups.delete(g.group),
    onSuccess: () => {
      setDeleteGroup(null);
      qc.invalidateQueries({ queryKey: ['ha', 'groups'] });
      toast.success('Group deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const groupRefs = (groupName: string) =>
    (resources ?? []).filter((r) => r.group === groupName).length;

  const statusByResource = new Map<string, string>();
  (haStatus ?? []).forEach((s) => {
    if (s.sid && s.state) statusByResource.set(s.sid, s.state);
  });

  const tabs = [
    { id: 'resources' as const, label: 'Resources', count: resources?.length },
    { id: 'groups' as const, label: 'Groups', count: groups?.length },
    { id: 'status' as const, label: 'Status', count: haStatus?.length },
  ];

  return (
    <div className="space-y-6">
      <ClusterStatusPanel />

      {deleteRes && (
        <ConfirmDialog
          title={`Remove ${deleteRes.sid} from HA?`}
          message="The guest stays in its current running state — HA just stops managing it. You can re-add it later."
          danger
          onConfirm={() => deleteResM.mutate(deleteRes)}
          onCancel={() => setDeleteRes(null)}
        />
      )}

      {deleteGroup && (
        groupRefs(deleteGroup.group) > 0 ? (
          <ConfirmDialog
            title="Group in use"
            message={`${groupRefs(deleteGroup.group)} resource(s) reference this group. Reassign or remove them before deleting the group.`}
            onConfirm={() => setDeleteGroup(null)}
            onCancel={() => setDeleteGroup(null)}
          />
        ) : (
          <ConfirmDialog
            title={`Delete HA group "${deleteGroup.group}"?`}
            message="This removes the group configuration. Member nodes are unaffected."
            danger
            onConfirm={() => deleteGroupM.mutate(deleteGroup)}
            onCancel={() => setDeleteGroup(null)}
          />
        )
      )}

      {(editRes || showNewRes) && (
        <HAResourceEditor
          initial={editRes}
          onClose={() => { setEditRes(null); setShowNewRes(false); }}
          onSaved={() => {
            setEditRes(null);
            setShowNewRes(false);
            qc.invalidateQueries({ queryKey: ['ha', 'resources'] });
          }}
        />
      )}

      {(editGroup || showNewGroup) && (
        <HAGroupEditor
          initial={editGroup}
          onClose={() => { setEditGroup(null); setShowNewGroup(false); }}
          onSaved={() => {
            setEditGroup(null);
            setShowNewGroup(false);
            qc.invalidateQueries({ queryKey: ['ha', 'groups'] });
          }}
        />
      )}

      {migrateTarget && (
        <HAMigrateDialog
          resource={migrateTarget.r}
          kind={migrateTarget.kind}
          onClose={() => setMigrateTarget(null)}
          onComplete={() => qc.invalidateQueries({ queryKey: ['ha'] })}
        />
      )}

      <TabBar tabs={tabs} value={sub} onChange={setSub} />

      {sub === 'resources' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewRes(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              Add resource
            </button>
          </div>

          {loadingRes ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" /></div>
          ) : !resources || resources.length === 0 ? (
            <EmptyState
              icon={HeartPulse}
              title="No HA resources"
              description="Add a VM or CT to HA management to have it auto-restart and failover across nodes."
            />
          ) : (
            <div className="studio-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">SID</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Desired</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Current</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Group</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Restart / Relocate</th>
                    <th className="text-right px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {resources.map((r) => {
                    const current = statusByResource.get(r.sid);
                    return (
                      <tr key={r.sid} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                        <td className="px-4 py-3 font-mono text-[var(--color-fg-secondary)]">{r.sid}</td>
                        <td className="px-4 py-3"><Badge variant={stateVariant(r.state)} className="text-xs">{r.state}</Badge></td>
                        <td className="px-4 py-3"><Badge variant={stateVariant(current)} className="text-xs">{current ?? 'unknown'}</Badge></td>
                        <td className="px-4 py-3 text-xs text-[var(--color-fg-muted)] font-mono">{r.group ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)]">
                          {r.max_restart ?? 1} / {r.max_relocate ?? 1}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => setMigrateTarget({ r, kind: 'migrate' })}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-blue-400 hover:text-blue-300 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"
                              title="Migrate (online)"
                            >
                              <ArrowRightLeft className="w-3 h-3" /> Migrate
                            </button>
                            <button
                              onClick={() => setMigrateTarget({ r, kind: 'relocate' })}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-[var(--color-warn)] hover:text-[var(--color-warn)] bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"
                              title="Relocate (offline)"
                            >
                              <Shuffle className="w-3 h-3" /> Relocate
                            </button>
                            <button
                              onClick={() => setEditRes(r)}
                              className="p-1 text-xs text-[var(--color-fg-secondary)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"
                              title="Edit"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setDeleteRes(r)}
                              className="p-1 text-xs text-[var(--color-err)] hover:text-[var(--color-err)] bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"
                              title="Remove from HA"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
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

      {sub === 'groups' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewGroup(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              New group
            </button>
          </div>

          {loadingGroups ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" /></div>
          ) : !groups || groups.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No HA groups"
              description="HA groups define the preferred node priority list and failover policy for resources."
            />
          ) : (
            <div className="studio-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Group</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Nodes (priority)</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Flags</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Used by</th>
                    <th className="text-right px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.group} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                      <td className="px-4 py-3 font-mono text-[var(--color-fg-secondary)]">{g.group}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-fg-muted)]">{g.nodes}</td>
                      <td className="px-4 py-3 space-x-1">
                        {g.restricted ? <Badge variant="warning" className="text-xs">restricted</Badge> : null}
                        {g.nofailback ? <Badge variant="outline" className="text-xs">no failback</Badge> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)]">{groupRefs(g.group)} resources</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditGroup(g)} className="p-1 text-xs text-[var(--color-fg-secondary)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition" title="Edit">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => setDeleteGroup(g)} className="p-1 text-xs text-[var(--color-err)] hover:text-[var(--color-err)] bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition" title="Delete">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {sub === 'status' && (
        <div className="space-y-4">
          {!haStatus || haStatus.length === 0 ? (
            <EmptyState
              icon={HeartPulse}
              title="No HA status entries"
              description="The HA manager will emit entries once resources are added and the cluster has an LRM/CRM."
            />
          ) : (
            <div className="studio-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">ID</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Type</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Node</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">State</th>
                    <th className="text-left px-4 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Request</th>
                  </tr>
                </thead>
                <tbody>
                  {haStatus.map((s) => (
                    <tr key={s.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-fg-secondary)]">{s.id}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-fg-muted)]">{s.type}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-fg-muted)] font-mono">{s.node ?? '—'}</td>
                      <td className="px-4 py-3"><Badge variant={stateVariant(s.state)} className="text-xs">{s.state ?? '—'}</Badge></td>
                      <td className="px-4 py-3 text-xs text-[var(--color-fg-subtle)]">{s.request_state ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

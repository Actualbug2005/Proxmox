'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { RuleEditor } from './rule-editor';
import { listRules, deleteRule, moveRule, scopeKey, type FirewallScope } from './firewall-scope';
import { Plus, Trash2, Pencil, ArrowUp, ArrowDown, Shield, Loader2 } from 'lucide-react';
import type { FirewallRulePublic } from '@/types/proxmox';

interface FirewallRulesTabProps {
  scope: FirewallScope;
}

export function FirewallRulesTab({ scope }: FirewallRulesTabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const keyBase = scopeKey(scope);

  const { data: rules, isLoading } = useQuery({
    queryKey: [...keyBase, 'rules'],
    queryFn: () => listRules(scope),
    refetchInterval: POLL_INTERVALS.config,
  });

  const [editRule, setEditRule] = useState<FirewallRulePublic | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FirewallRulePublic | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: [...keyBase, 'rules'] });

  const deleteM = useMutation({
    mutationFn: (r: FirewallRulePublic) => deleteRule(scope, r.pos, r.digest),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
      toast.success('Rule deleted');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const moveM = useMutation({
    mutationFn: (p: { r: FirewallRulePublic; delta: number }) =>
      moveRule(scope, p.r.pos, p.r.pos + p.delta, p.r.digest),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error('Move failed', err instanceof Error ? err.message : String(err)),
  });

  const sorted = (rules ?? []).slice().sort((a, b) => a.pos - b.pos);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          New rule
        </button>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete rule #${deleteTarget.pos}?`}
          message={`This removes the ${deleteTarget.type} ${deleteTarget.action} rule.`}
          danger
          onConfirm={() => deleteM.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {(editRule || showNew) && (
        <RuleEditor
          scope={scope}
          initial={editRule}
          onClose={() => { setEditRule(null); setShowNew(false); }}
          onSaved={() => { setEditRule(null); setShowNew(false); invalidate(); }}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" /></div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No firewall rules"
          description="Without rules, the default policy (set in Options) applies to all traffic."
        />
      ) : (
        <div className="studio-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium w-16">#</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Type</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Action</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Source</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Dest</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Proto</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Port</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Macro</th>
                <th className="text-left px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium">Comment</th>
                <th className="text-right px-3 py-3 text-xs text-[var(--color-fg-subtle)] font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, idx) => (
                <tr key={r.pos} className={r.enable === false ? 'opacity-50 border-b border-zinc-800/40' : 'border-b border-zinc-800/40 hover:bg-zinc-800/20'}>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-fg-subtle)]">{r.pos}</td>
                  <td className="px-3 py-3">
                    <Badge variant={r.type === 'in' ? 'success' : r.type === 'out' ? 'warning' : 'outline'} className="text-xs">
                      {r.type}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={r.action === 'ACCEPT' ? 'success' : r.action === 'DROP' || r.action === 'REJECT' ? 'danger' : 'outline'} className="text-xs">
                      {r.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-fg-muted)]">{r.source ?? '—'}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-fg-muted)]">{r.dest ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-[var(--color-fg-muted)]">{r.proto ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-[var(--color-fg-muted)]">{r.dport ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-[var(--color-fg-muted)]">{r.macro ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-[var(--color-fg-subtle)] truncate max-w-[12rem]" title={r.comment}>{r.comment ?? ''}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex gap-0.5 justify-end">
                      <button
                        onClick={() => moveM.mutate({ r, delta: -1 })}
                        disabled={idx === 0 || moveM.isPending}
                        className="p-1 text-[var(--color-fg-subtle)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-30"
                        title="Move up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveM.mutate({ r, delta: 1 })}
                        disabled={idx === sorted.length - 1 || moveM.isPending}
                        className="p-1 text-[var(--color-fg-subtle)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-30"
                        title="Move down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setEditRule(r)}
                        className="p-1 text-[var(--color-fg-secondary)] hover:text-white bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"
                        title="Edit"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="p-1 text-[var(--color-err)] hover:text-[var(--color-err)] bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] rounded-lg transition"
                        title="Delete"
                      >
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
  );
}

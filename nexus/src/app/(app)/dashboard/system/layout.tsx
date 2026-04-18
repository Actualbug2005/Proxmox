'use client';

import { useState } from 'react';
import { useNodes, useDefaultNode } from '@/hooks/use-cluster';
import { Loader2 } from 'lucide-react';
import { SystemNodeContext } from './node-context';

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  const { data: nodes, isLoading } = useNodes();
  const defaultNode = useDefaultNode();
  // Explicit user selection; empty until the user picks or an async default
  // is available. Derivation happens at the context boundary so consumers
  // never see '' while `defaultNode` is in flight.
  const [node, setNode] = useState('');
  const effectiveNode = node || defaultNode || '';

  return (
    <SystemNodeContext.Provider value={{ node: effectiveNode, setNode }}>
      <div className="p-6 space-y-6">
        {/* Node selector header */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-fg-subtle)] shrink-0">Node:</span>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-fg-muted)]" />
          ) : (
            <select
              value={effectiveNode}
              onChange={(e) => setNode(e.target.value)}
              className="px-3 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
            >
              {nodes?.map((n) => {
                const name = n.node ?? n.id ?? '';
                return (
                  <option key={name} value={name}>
                    {name} {n.status !== 'online' ? '(offline)' : ''}
                  </option>
                );
              })}
            </select>
          )}
        </div>
        {children}
      </div>
    </SystemNodeContext.Provider>
  );
}

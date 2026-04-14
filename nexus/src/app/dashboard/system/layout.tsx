'use client';

import { useState, useEffect } from 'react';
import { useNodes } from '@/hooks/use-cluster';
import { Loader2 } from 'lucide-react';
import { SystemNodeContext } from './node-context';

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  const { data: nodes, isLoading } = useNodes();
  const [node, setNode] = useState('');

  useEffect(() => {
    if (!node && nodes && nodes.length > 0) {
      const first = nodes.find((n) => n.status === 'online') ?? nodes[0];
      setNode(first.node ?? first.id ?? '');
    }
  }, [nodes, node]);

  return (
    <SystemNodeContext.Provider value={{ node, setNode }}>
      <div className="p-6 space-y-6">
        {/* Node selector header */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 shrink-0">Node:</span>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
          ) : (
            <select
              value={node}
              onChange={(e) => setNode(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
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

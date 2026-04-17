'use client';

/**
 * Floating bottom-left panel showing any script chain that's currently
 * in flight (at least one step still pending/running).
 *
 * Parallel to JobStatusBar but positioned on the left so both can be
 * visible simultaneously on a single screen. Hidden entirely when idle —
 * polls at 2s via useChainsLive while active, drops to 30s otherwise.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Workflow,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  isChainInFlight,
  useChainsLive,
  type ChainDto,
  type ChainStepRun,
} from '@/hooks/use-chains';

export function ChainProgressPanel() {
  const { data } = useChainsLive();
  const [collapsed, setCollapsed] = useState(false);

  const live = (data?.chains ?? []).filter(isChainInFlight);
  if (live.length === 0) return null;

  return (
    <div
      className={cn(
        'fixed bottom-4 left-4 z-40 w-80 max-w-[calc(100vw-2rem)]',
        'rounded-2xl border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur',
        // On mobile the left-4 keeps it inside the safe area; on lg+ it
        // sits next to the sidebar capsule.
        'lg:left-[272px]',
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left hover:bg-white/[0.03]"
      >
        <Workflow className="h-3.5 w-3.5 text-indigo-400" />
        <span className="flex-1 text-xs font-medium text-[var(--color-fg-secondary)]">
          {live.length} chain{live.length === 1 ? '' : 's'} running
        </span>
        {collapsed ? (
          <ChevronUp className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
        )}
      </button>

      {!collapsed && (
        <div className="max-h-80 overflow-y-auto">
          {live.map((chain) => (
            <ChainProgressRow key={chain.id} chain={chain} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChainProgressRow({ chain }: { chain: ChainDto }) {
  const total = chain.steps.length;
  const done = (chain.lastRun ?? []).filter(
    (s) => s.status === 'success' || s.status === 'failed' || s.status === 'skipped',
  ).length;

  return (
    <Link
      href="/dashboard/chains"
      className="block border-b border-white/5 px-3 py-2 transition hover:bg-white/[0.04] last:border-b-0"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-fg)]">{chain.name}</span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--color-fg-subtle)]">
          {done}/{total}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {(chain.lastRun ?? []).map((run, i) => (
          <StepDot key={i} run={run} />
        ))}
      </div>
    </Link>
  );
}

function StepDot({ run }: { run: ChainStepRun }) {
  switch (run.status) {
    case 'success':
      return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
    case 'failed':
      return <XCircle className="h-3 w-3 text-red-400" />;
    case 'running':
      return <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />;
    case 'skipped':
      return <div className="h-2 w-2 rounded-full bg-zinc-700" />;
    default:
      return <div className="h-2 w-2 rounded-full bg-zinc-500" />;
  }
}

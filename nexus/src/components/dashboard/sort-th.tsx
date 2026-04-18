'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';

interface SortThProps<K extends string> {
  label: string;
  k: K;
  align?: 'left' | 'right';
  sortKey: K;
  sortDir: SortDir;
  onToggle: (k: K) => void;
}

/**
 * Sortable table-header cell shared across VM/CT list pages.
 *
 * Hoisted out of the page component to satisfy react-hooks/static-components
 * — defining a component inside another component's render body creates a
 * new identity each render, which breaks memoisation and React's DevTools.
 * Parent owns the sort state; this cell is presentational only.
 */
export function SortTh<K extends string>({
  label,
  k,
  align = 'left',
  sortKey,
  sortDir,
  onToggle,
}: SortThProps<K>) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onToggle(k)}
      className={cn(
        'px-3 py-3 text-[11px] font-semibold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
        active
          ? 'text-[var(--color-fg-secondary)]'
          : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
      )}
    >
      {label}
      {active && <ChevronDown className={cn('inline w-3 h-3 ml-1', sortDir === 'desc' && 'rotate-180')} />}
    </th>
  );
}

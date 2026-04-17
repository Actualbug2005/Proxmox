'use client';

import { cn } from '@/lib/utils';

export interface TabItem<Id extends string = string> {
  id: Id;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface TabBarProps<Id extends string> {
  tabs: readonly TabItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  className?: string;
}

export function TabBar<Id extends string>({ tabs, value, onChange, className }: TabBarProps<Id>) {
  return (
    // overflow-x-auto on the track lets tab rows scroll horizontally on
    // narrow viewports instead of wrapping + squishing. `-mx-4 px-4` on
    // mobile restores the viewport-edge bleed so a half-hidden tab hints
    // that there's more to the right; reset at sm+.
    <div
      className={cn(
        'flex gap-1 border-b border-[var(--color-border-subtle)] overflow-x-auto',
        '-mx-4 px-4 sm:mx-0 sm:px-0',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap',
              active
                ? 'border-zinc-200 text-indigo-400'
                : 'border-transparent text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
              t.disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className={cn('ml-2 text-xs tabular-nums', active ? 'text-indigo-300' : 'text-[var(--color-fg-faint)]')}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

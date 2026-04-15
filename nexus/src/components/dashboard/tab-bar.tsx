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
    <div className={cn('flex gap-1 border-b border-gray-800', className)}>
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
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
              t.disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className={cn('ml-2 text-xs tabular-nums', active ? 'text-orange-300' : 'text-gray-600')}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

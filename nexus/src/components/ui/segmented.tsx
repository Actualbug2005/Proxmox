'use client';

/**
 * Segmented control — pill-style toggle for picking one of N options.
 * Generic over the option type so callers stay type-safe (no string
 * round-tripping) and the rendered label can differ from the value.
 */
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  ariaLabel?: string;
  className?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg p-0.5',
        'bg-[var(--color-overlay)] border border-[var(--color-border-subtle)]',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition',
              active
                ? 'bg-[var(--color-cta)] text-[var(--color-cta-fg)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

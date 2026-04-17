'use client';

/**
 * Tri-state checkbox primitive.
 *
 * Why custom rather than native <input type="checkbox">: the indeterminate
 * state on a native input can only be set via a DOM property (no attribute,
 * no React prop), which makes it awkward in functional components. A
 * button-based ARIA checkbox gives us full control and matches the rest of
 * the app's styling conventions.
 */

import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CheckboxState = boolean | 'indeterminate';

interface CheckboxProps {
  checked: CheckboxState;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

export function Checkbox({
  checked,
  onChange,
  ariaLabel,
  className,
  disabled,
}: CheckboxProps) {
  const active = checked === true || checked === 'indeterminate';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        // Parent rows may themselves be <Link>s or <button>s; stop the
        // click from triggering a navigation / selection side-effect.
        e.preventDefault();
        e.stopPropagation();
        // Tri-state → checked semantics: indeterminate toggles TO false,
        // matching the gmail-style "click the header row to deselect all"
        // behavior. Checked toggles to false, unchecked toggles to true.
        onChange(checked !== true);
      }}
      className={cn(
        'shrink-0 w-4 h-4 rounded border transition flex items-center justify-center',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
        active
          ? 'bg-indigo-500 border-indigo-400 text-white'
          : 'bg-[var(--color-surface)] border-[var(--color-border-strong)] hover:border-[var(--color-fg-subtle)]',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {checked === 'indeterminate' && <Minus className="w-3 h-3" />}
      {checked === true && <Check className="w-3 h-3" />}
    </button>
  );
}

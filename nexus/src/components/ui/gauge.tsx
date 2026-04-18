import { cn } from '@/lib/utils';

/**
 * Gauge — compact usage bar for tables and cards.
 *
 * Solid Industrial rev: rail is h-2 (8px) and the fill is a single
 * high-intent color, not a gradient. Severity encodes by threshold:
 *
 *   ≤65%   → emerald-500 (healthy)
 *   66–85% → amber-500   (attention)
 *   >85%   → red-500     (critical)
 */

interface GaugeProps {
  /** 0–100 (values outside are clamped) */
  value: number;
  className?: string;
  /** aria-label for screen readers */
  label?: string;
}

function colorFor(pct: number): string {
  if (pct > 85) return 'bg-[var(--color-err)]';
  if (pct > 65) return 'bg-[var(--color-warn)]';
  return 'bg-[var(--color-ok)]';
}

export function Gauge({ value, className, label }: GaugeProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-[var(--color-overlay)]', className)}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', colorFor(clamped))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

import { cn } from '@/lib/utils';

/**
 * ProgressBar — general-purpose progress indicator for the wider UI
 * (upload progress, long-running dialogs, aggregate capacity cards).
 *
 * For dense tables, prefer <Gauge /> which is 3px tall. This one stays 4px
 * and uses the same threshold-driven gradient for visual consistency.
 */

interface ProgressBarProps {
  value: number; // 0–100
  className?: string;
  /** Override the auto gradient (e.g. brand colour for non-severity contexts) */
  colorClass?: string;
}

function gradientFor(pct: number): string {
  if (pct > 85) return 'bg-gradient-to-r from-red-600 to-red-400';
  if (pct > 65) return 'bg-gradient-to-r from-amber-600 to-amber-400';
  return 'bg-gradient-to-r from-emerald-600 to-emerald-400';
}

export function ProgressBar({ value, className, colorClass }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const color = colorClass ?? gradientFor(clamped);

  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-zinc-800/70', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

import { cn } from '@/lib/utils';

/**
 * ProgressBar — general-purpose progress indicator.
 *
 * Solid Industrial rev: same 8px rail as <Gauge /> with solid severity
 * colors. The two components are intentionally interchangeable now —
 * use whichever name reads better at the call site.
 */

interface ProgressBarProps {
  value: number; // 0–100
  className?: string;
  /** Override the auto color (e.g. brand colour for non-severity contexts) */
  colorClass?: string;
}

function colorFor(pct: number): string {
  if (pct > 85) return 'bg-red-500';
  if (pct > 65) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function ProgressBar({ value, className, colorClass }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const color = colorClass ?? colorFor(clamped);

  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-zinc-800', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

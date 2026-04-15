import { cn } from '@/lib/utils';

/**
 * Gauge — compact 3px rail for table-row usage metrics.
 *
 * Thinner and denser than ProgressBar (which stays 4px post-refactor for
 * general UI). Uses a threshold-driven gradient fill so the colour encodes
 * both magnitude and severity at a glance:
 *
 *   ≤65%  → emerald (healthy)
 *   66–85% → amber (attention)
 *   >85%  → red (critical)
 *
 * Gradient from a darker shade on the left to a brighter shade on the right
 * adds subtle depth without requiring a shadow.
 */

interface GaugeProps {
  /** 0–100 (values outside are clamped) */
  value: number;
  className?: string;
  /** aria-label for screen readers */
  label?: string;
}

function gradientFor(pct: number): string {
  if (pct > 85) return 'bg-gradient-to-r from-red-600 to-red-400';
  if (pct > 65) return 'bg-gradient-to-r from-amber-600 to-amber-400';
  return 'bg-gradient-to-r from-emerald-600 to-emerald-400';
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
      className={cn('h-[3px] w-full overflow-hidden rounded-full bg-zinc-800/70', className)}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', gradientFor(clamped))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

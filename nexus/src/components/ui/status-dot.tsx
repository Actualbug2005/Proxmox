import { cn } from '@/lib/utils';

/**
 * StatusDot — a compact lifecycle indicator for tables and lists.
 *
 * Used in place of the old <Badge variant="success"><Circle />{status}</Badge>
 * pattern. Renders as a pure rounded-full span with an inset ring for depth;
 * an optional ping halo signals liveness on 'running' rows.
 *
 * Kept dependency-free (no lucide icon inside) so dozens can render cheaply in
 * a dense table without layout churn.
 */

export type DotStatus =
  | 'running'
  | 'stopped'
  | 'paused'
  | 'suspended'
  | 'warning'
  | 'error'
  | 'unknown';

export type DotSize = 'sm' | 'md';

interface StatusDotProps {
  status: DotStatus | string | undefined;
  size?: DotSize;
  /** Override the halo (ping animation) on 'running'. Default: true */
  halo?: boolean;
  className?: string;
  'aria-label'?: string;
}

const sizeClasses: Record<DotSize, string> = {
  sm: 'h-1.5 w-1.5', // 6px
  md: 'h-2 w-2',     // 8px
};

/**
 * Default style map per lifecycle state.
 *
 * REVIEW: the `pulse: false` everywhere is a deliberate default — ping halos
 * in dense tables are noisy when many VMs are running. If you'd prefer the
 * running state to animate (on detail pages, say), flip `running.pulse` to
 * `true` or pass `halo={false}` on table rows only.
 *
 * Color rationale:
 *   - emerald  → healthy live state (running)
 *   - zinc     → quiescent, non-failure (stopped)
 *   - amber    → user-initiated hold (paused / suspended — distinct hues via
 *                brightness: -400 vs -500)
 *   - red      → needs attention (error)
 *   - orange   → degraded but not failed (warning) — uses brand accent
 *   - zinc-600 → disconnected / no data (unknown)
 */
const statusStyles: Record<DotStatus, { fill: string; ring: string; pulse: boolean }> = {
  running:   { fill: 'bg-emerald-400', ring: 'ring-emerald-400/25', pulse: false },
  stopped:   { fill: 'bg-zinc-500',    ring: 'ring-zinc-500/25',    pulse: false },
  paused:    { fill: 'bg-amber-400',   ring: 'ring-amber-400/25',   pulse: false },
  suspended: { fill: 'bg-amber-500',   ring: 'ring-amber-500/25',   pulse: false },
  warning:   { fill: 'bg-orange-400',  ring: 'ring-orange-400/30',  pulse: false },
  error:     { fill: 'bg-red-400',     ring: 'ring-red-400/30',     pulse: false },
  unknown:   { fill: 'bg-zinc-600',    ring: 'ring-zinc-600/25',    pulse: false },
};

function resolveStatus(raw: string | undefined): DotStatus {
  if (!raw) return 'unknown';
  if (raw in statusStyles) return raw as DotStatus;
  return 'unknown';
}

export function StatusDot({
  status,
  size = 'md',
  halo = true,
  className,
  'aria-label': ariaLabel,
}: StatusDotProps) {
  const resolved = resolveStatus(status);
  const styles = statusStyles[resolved];
  const showPing = halo && styles.pulse;

  return (
    <span
      role="status"
      aria-label={ariaLabel ?? `Status: ${resolved}`}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
    >
      {showPing && (
        <span
          aria-hidden
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            styles.fill,
            sizeClasses[size],
          )}
        />
      )}
      <span
        aria-hidden
        className={cn(
          'relative inline-block rounded-full ring-1 ring-inset',
          sizeClasses[size],
          styles.fill,
          styles.ring,
        )}
      />
    </span>
  );
}

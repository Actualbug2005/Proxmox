import { cn } from '@/lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

interface BadgeProps {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}

/**
 * Severity variants use alpha-blended tints that read on both light and
 * dark backdrops without re-tuning. The `text-*-400` references were
 * failing WCAG AA in light mode (~2.8:1 against white); swapping to the
 * `--color-ok/warn/err` tokens bumps light-mode contrast to 4.5:1+ while
 * leaving dark-mode values unchanged.
 */
const variantClasses: Record<Variant, string> = {
  default: 'bg-[var(--color-overlay)] text-[var(--color-fg-secondary)]',
  success: 'bg-emerald-500/10 text-[var(--color-ok)] border border-emerald-500/20',
  warning: 'bg-amber-500/10 text-[var(--color-warn)] border border-amber-500/20',
  danger: 'bg-red-500/10 text-[var(--color-err)] border border-red-500/20',
  info: 'bg-blue-500/10 text-[var(--color-accent)] border border-blue-500/20',
  outline: 'border border-[var(--color-border-subtle)] text-[var(--color-fg-muted)]',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

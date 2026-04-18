'use client';

/**
 * Button primitive — single source of truth for the "primary CTA" /
 * "secondary CTA" / "danger" treatments that were copy-pasted across
 * 15+ component files.
 *
 * The variants reference `--color-cta*` tokens (defined in globals.css)
 * so the same markup flips correctly when the user toggles the theme.
 * Previous hand-rolled `bg-zinc-300 hover:bg-zinc-200 text-zinc-900`
 * chains inverted meaninglessly under the Frosted Glass light theme.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] disabled:opacity-40',
  secondary:
    'bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] disabled:opacity-40',
  ghost:
    'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-overlay)] disabled:opacity-40',
  danger:
    'bg-[var(--color-err)] hover:opacity-90 text-white disabled:opacity-40',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // Default `type="button"` so a Button rendered inside a <form> doesn't
      // accidentally submit. Callers pass `type="submit"` explicitly when
      // form submission is desired.
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-fg-secondary)]',
        'disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    />
  );
});

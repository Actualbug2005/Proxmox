'use client';

/**
 * ThemeToggle — tri-state cycling toggle: system -> light -> dark -> system.
 *
 * Rendered in the sidebar user row next to the logout button. Shows the
 * icon of the *current* mode; clicking advances to the next. Screen
 * readers announce the current mode via aria-label, and a title gives
 * sighted users the same hint on hover.
 */

import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from '@/hooks/use-theme';

const ORDER: ThemeMode[] = ['system', 'light', 'dark'];

const MODE_META: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  system: { label: 'Follow system', icon: Monitor },
  light: { label: 'Light mode', icon: Sun },
  dark: { label: 'Dark mode', icon: Moon },
};

export function ThemeToggle({ className }: { className?: string }) {
  const { themeMode, setTheme } = useTheme();

  // Before mount, `themeMode` is undefined — render the system icon as a
  // placeholder. Matches the default ThemeProvider setting so the click
  // after hydration still lands on the expected next step.
  const current = themeMode ?? 'system';
  const meta = MODE_META[current];
  const Icon = meta.icon;

  const next = () => {
    const idx = ORDER.indexOf(current);
    setTheme(ORDER[(idx + 1) % ORDER.length]);
  };

  return (
    <button
      type="button"
      onClick={next}
      title={meta.label}
      aria-label={meta.label}
      className={cn(
        'rounded-md p-1 text-[var(--color-fg-muted)] transition',
        'hover:text-[var(--color-fg)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-strong)]',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

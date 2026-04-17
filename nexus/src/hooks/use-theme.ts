'use client';

/**
 * Typed wrapper around `next-themes`' useTheme.
 *
 * next-themes exposes `theme` as `string | undefined` during the first
 * render (SSR) because it doesn't know the cookie value yet. Wrapping it
 * here lets consumers destructure a typed union without sprinkling
 * `as ThemeMode` narrowings at call sites.
 *
 * `themeMode` is the user's explicit choice ('dark' | 'light' | 'system').
 * `resolvedTheme` is what actually paints right now — if the user picked
 * 'system' and the OS is light, resolvedTheme is 'light'. Components
 * usually want resolvedTheme; the toggle UI wants themeMode.
 */

import { useTheme as useNextTheme } from 'next-themes';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export interface UseThemeResult {
  /** The user's explicit selection. `undefined` only before mount. */
  themeMode: ThemeMode | undefined;
  /** What actually paints — resolves 'system' against the OS preference. */
  resolvedTheme: ResolvedTheme | undefined;
  setTheme(mode: ThemeMode): void;
}

function isThemeMode(value: string | undefined): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

function isResolved(value: string | undefined): value is ResolvedTheme {
  return value === 'dark' || value === 'light';
}

export function useTheme(): UseThemeResult {
  const { theme, resolvedTheme, setTheme } = useNextTheme();
  return {
    themeMode: isThemeMode(theme) ? theme : undefined,
    resolvedTheme: isResolved(resolvedTheme) ? resolvedTheme : undefined,
    setTheme,
  };
}

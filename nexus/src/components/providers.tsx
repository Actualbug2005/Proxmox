'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { POLL_INTERVALS } from '@/hooks/use-cluster';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            // Global default. Per-query hooks override with the specific
            // POLL_INTERVALS.* key that fits their cadence; this is the
            // fallback for queries that don't set refetchInterval at all.
            refetchInterval: POLL_INTERVALS.cluster,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/*
       * Theme provider — data-theme attribute on <html>, persisted in a
       * cookie so middleware-less SSR still emits the right class on first
       * paint (next-themes sets it inline via a small script injected into
       * <head>, so there's no FOUC even without server-side cookie read).
       *
       * `enableSystem` honours the OS preference as a third option; the
       * toggle cycles dark -> light -> system.
       */}
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

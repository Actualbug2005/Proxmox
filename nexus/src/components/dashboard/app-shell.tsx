'use client';

/**
 * AppShell — client wrapper for the authenticated layout.
 *
 * Owns the drawer state for the responsive sidebar. Everything above
 * the `lg` breakpoint behaves exactly as before (sidebar always visible);
 * below it the sidebar collapses behind a hamburger, renders an overlay
 * scrim when open, and closes on nav-link click (handled inside Sidebar).
 *
 * Kept as a dedicated client component so the parent (app)/layout.tsx
 * can stay server-rendered and still gate on the session cookie.
 */

import { useCallback, useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Sidebar } from '@/components/dashboard/sidebar';
import { cn } from '@/lib/utils';

interface AppShellProps {
  username?: string;
  children: React.ReactNode;
}

export function AppShell({ username, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on ESC, matching the existing modal convention.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const close = useCallback(() => setDrawerOpen(false), []);

  return (
    <>
      {/* Mobile hamburger — only visible below lg. Placed top-left so it
       *  does not fight with the command palette shortcut hint. */}
      <button
        type="button"
        onClick={() => setDrawerOpen((o) => !o)}
        className={cn(
          'fixed top-3 left-3 z-50 lg:hidden',
          'h-10 w-10 rounded-full flex items-center justify-center',
          'bg-zinc-900/80 backdrop-blur border border-white/10 text-zinc-100',
          'hover:bg-zinc-800 transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
        )}
        aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={drawerOpen}
      >
        {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay scrim — only drawn on mobile when open. Tapping it closes
       *  the drawer, matching OS-wide "tap-out" conventions. */}
      {drawerOpen && (
        <button
          type="button"
          onClick={close}
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      <Sidebar username={username} open={drawerOpen} onClose={close} />

      {/* Main content — reserves the sidebar gutter only at lg+. Mobile
       *  uses a uniform px-4 padding plus top-16 so the hamburger doesn't
       *  occlude the first line of content. */}
      <main className="min-h-screen w-full transition-all duration-300 px-4 pt-16 pb-4 lg:pl-[272px] lg:pr-4 lg:py-4">
        {children}
      </main>
    </>
  );
}

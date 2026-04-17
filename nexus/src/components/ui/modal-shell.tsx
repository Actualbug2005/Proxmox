'use client';

/**
 * ModalShell — responsive modal wrapper.
 *
 * Below sm (640 px) the card fills the viewport corner-to-corner so
 * phone users get a near-native-app feel with reachable bottom
 * buttons. At sm+ it behaves like the existing handrolled modals:
 * centred, padded, rounded, with a 2rem gutter.
 *
 * The outer scrim + centring container is fixed here so consumers
 * only pass their inner content + close handler.
 */

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

export type ModalSize = 'md' | 'lg' | 'xl' | '2xl' | '5xl';

interface ModalShellProps {
  children: React.ReactNode;
  /** Max width at sm+. Mobile ignores it. Defaults to 'lg' (max-w-lg). */
  size?: ModalSize;
  /** Outside-click + ESC → onClose. Pass undefined to disable auto-close. */
  onClose?: () => void;
  className?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '5xl': 'sm:max-w-5xl',
};

export function ModalShell({
  children,
  size = 'lg',
  onClose,
  className,
}: ModalShellProps) {
  // ESC to close — matches the convention from the existing correlation
  // drawer and editors. No focus trap yet; keep this minimal.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 overflow-y-auto sm:py-8"
      onClick={(e) => {
        // Outside click — only fire when the target is the scrim itself,
        // never when it's a child of the card.
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={cn(
          'studio-card w-full sm:w-full h-full sm:h-auto',
          'sm:rounded-lg p-4 sm:p-6 shadow-2xl',
          SIZE_CLASS[size],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

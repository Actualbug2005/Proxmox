'use client';

import { X } from 'lucide-react';
import { ModalShell } from '@/components/ui/modal-shell';
import { PoolsPageBody } from './pools-page-body';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Pools management modal. Builds on `ModalShell` to inherit ESC-to-close
 * and the scrim `target === currentTarget` guard that prevents a drag
 * ending outside the card from dismissing. The dialog `role` and label
 * live on the inner content div because `ModalShell`'s own card is a
 * generic visual container shared by every modal in the app.
 */
export function PoolsModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <ModalShell size="5xl" onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Manage pools">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">Pools</h2>
          <button
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <PoolsPageBody />
      </div>
    </ModalShell>
  );
}

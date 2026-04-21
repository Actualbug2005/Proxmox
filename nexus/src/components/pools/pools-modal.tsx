'use client';

import { X } from 'lucide-react';
import { PoolsPageBody } from './pools-page-body';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PoolsModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Manage pools"
    >
      <div
        className="liquid-glass rounded-[24px] w-[min(900px,95vw)] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5">
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
    </div>
  );
}

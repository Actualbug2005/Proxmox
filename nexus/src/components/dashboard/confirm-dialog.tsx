'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    // Backdrop dismisses on click; the studio-card stops propagation so a
    // click inside the dialog body doesn't accidentally close it.
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8"
    >
      <div onClick={(e) => e.stopPropagation()} className="studio-card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className={cn('w-5 h-5 mt-0.5 shrink-0', danger ? 'text-[var(--color-err)]' : 'text-[var(--color-warn)]')} />
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </div>
  );
}

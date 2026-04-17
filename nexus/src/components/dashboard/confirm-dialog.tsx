'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto sm:py-8">
      <div className="studio-card p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className={cn('w-5 h-5 mt-0.5 shrink-0', danger ? 'text-red-400' : 'text-yellow-400')} />
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-sm text-zinc-400 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition',
              danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-zinc-300 hover:bg-zinc-200 text-zinc-900',
            )}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, ...t }]);
  }, []);

  const value: ToastContextValue = {
    push,
    success: (title, message) => push({ variant: 'success', title, message }),
    error: (title, message) => push({ variant: 'error', title, message }),
    info: (title, message) => push({ variant: 'info', title, message }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster items={items} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

function Toaster({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <ToastView key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, item.variant === 'error' ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [item.variant, onDismiss]);

  const Icon = item.variant === 'success' ? CheckCircle2 : item.variant === 'error' ? AlertCircle : Info;
  const tone =
    item.variant === 'success'
      ? 'border-emerald-500/30 text-emerald-300'
      : item.variant === 'error'
        ? 'border-red-500/30 text-red-300'
        : 'border-blue-500/30 text-blue-300';

  return (
    <div
      className={cn(
        'pointer-events-auto min-w-72 max-w-sm bg-gray-900 border rounded-xl shadow-2xl px-4 py-3 flex items-start gap-3',
        tone,
      )}
      role="status"
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{item.title}</p>
        {item.message && <p className="text-xs text-gray-400 mt-0.5 break-words">{item.message}</p>}
      </div>
      <button
        onClick={onDismiss}
        className="text-gray-500 hover:text-gray-200 transition shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

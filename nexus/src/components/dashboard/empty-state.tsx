'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-12 px-6 studio-card',
        className,
      )}
    >
      {Icon && (
        <div className="w-12 h-12 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg flex items-center justify-center mb-4">
          <Icon className="w-5 h-5 text-[var(--color-fg-subtle)]" />
        </div>
      )}
      <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{title}</p>
      {description && <p className="text-xs text-[var(--color-fg-subtle)] mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

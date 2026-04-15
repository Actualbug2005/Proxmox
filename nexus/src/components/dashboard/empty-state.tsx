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
        'flex flex-col items-center justify-center text-center py-12 px-6 bg-gray-900 border border-gray-800 rounded-xl',
        className,
      )}
    >
      {Icon && (
        <div className="w-12 h-12 bg-gray-800 border border-gray-700 rounded-xl flex items-center justify-center mb-4">
          <Icon className="w-5 h-5 text-gray-500" />
        </div>
      )}
      <p className="text-sm font-medium text-gray-200">{title}</p>
      {description && <p className="text-xs text-gray-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

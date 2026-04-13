import { cn } from '@/lib/utils';
import { ProgressBar } from './progress-bar';

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  percent?: number;
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, sub, percent, icon, className }: StatCardProps) {
  return (
    <div className={cn('bg-gray-900 border border-gray-800 rounded-xl p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        {icon && <span className="text-gray-600">{icon}</span>}
      </div>
      <div className="text-2xl font-semibold text-white mb-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mb-2">{sub}</div>}
      {percent !== undefined && <ProgressBar value={percent} />}
    </div>
  );
}

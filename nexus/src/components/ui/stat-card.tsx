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
    <div className={cn('studio-card p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">{label}</span>
        {icon && <span className="text-zinc-500">{icon}</span>}
      </div>
      <div className="text-2xl font-semibold tabular text-zinc-50 mb-1">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mb-2 tabular">{sub}</div>}
      {percent !== undefined && <ProgressBar value={percent} />}
    </div>
  );
}

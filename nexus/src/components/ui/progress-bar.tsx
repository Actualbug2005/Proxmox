import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number; // 0–100
  className?: string;
  colorClass?: string;
}

export function ProgressBar({ value, className, colorClass }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const color =
    colorClass ??
    (clamped > 85 ? 'bg-red-500' : clamped > 65 ? 'bg-yellow-500' : 'bg-emerald-500');

  return (
    <div className={cn('w-full bg-gray-800 rounded-full h-1.5 overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

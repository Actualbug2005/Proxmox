'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Cron editor. Proxmox schedule syntax is a superset of classic cron — it accepts
 * `* / 5` (without the space), ranges like `1-5`, comma lists, and day-of-week
 * keywords (`mon..fri`). The builder handles the common cases; the raw-text tab
 * lets users drop in any expression PVE accepts.
 *
 * Fields: minute hour day-of-month month day-of-week
 * Example: "0 2 * * *" = "daily at 02:00"
 */

interface CronInputProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}

const MINUTE_PRESETS = ['0', '*/5', '*/10', '*/15', '*/30', '*'] as const;
const HOUR_PRESETS = ['0', '2', '6', '12', '18', '*'] as const;
const DOW_PRESETS: readonly { value: string; label: string }[] = [
  { value: '*', label: 'Every day' },
  { value: 'mon..fri', label: 'Weekdays' },
  { value: 'sat,sun', label: 'Weekends' },
  { value: 'mon', label: 'Mondays' },
  { value: 'tue', label: 'Tuesdays' },
  { value: 'wed', label: 'Wednesdays' },
  { value: 'thu', label: 'Thursdays' },
  { value: 'fri', label: 'Fridays' },
  { value: 'sat', label: 'Saturdays' },
  { value: 'sun', label: 'Sundays' },
];

function splitCron(expr: string): [string, string, string, string, string] {
  const parts = expr.trim().split(/\s+/);
  while (parts.length < 5) parts.push('*');
  return [parts[0], parts[1], parts[2], parts[3], parts[4]];
}

function joinCron(minute: string, hour: string, dom: string, month: string, dow: string): string {
  return [minute, hour, dom, month, dow].map((p) => (p.trim() === '' ? '*' : p.trim())).join(' ');
}

export function CronInput({ value, onChange, className }: CronInputProps) {
  const [mode, setMode] = useState<'builder' | 'raw'>('builder');
  const [minute, hour, dom, month, dow] = splitCron(value || '0 2 * * *');
  const [raw, setRaw] = useState(value);

  useEffect(() => setRaw(value), [value]);

  const update = (partial: Partial<Record<'minute' | 'hour' | 'dom' | 'month' | 'dow', string>>) => {
    onChange(
      joinCron(
        partial.minute ?? minute,
        partial.hour ?? hour,
        partial.dom ?? dom,
        partial.month ?? month,
        partial.dow ?? dow,
      ),
    );
  };

  const inputCls =
    'px-3 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50';

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex gap-1 bg-[var(--color-overlay)] p-1 rounded-lg w-fit">
        {(['builder', 'raw'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition',
              mode === m ? 'bg-[var(--color-overlay)] text-white' : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
            )}
          >
            {m === 'builder' ? 'Builder' : 'Raw'}
          </button>
        ))}
      </div>

      {mode === 'builder' ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Minute</label>
            <select value={minute} onChange={(e) => update({ minute: e.target.value })} className={cn(inputCls, 'w-full')}>
              {MINUTE_PRESETS.map((v) => (
                <option key={v} value={v}>
                  {v === '*' ? 'every minute' : v.startsWith('*/') ? `every ${v.slice(2)} min` : `at :${v.padStart(2, '0')}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Hour</label>
            <select value={hour} onChange={(e) => update({ hour: e.target.value })} className={cn(inputCls, 'w-full')}>
              {HOUR_PRESETS.map((v) => (
                <option key={v} value={v}>
                  {v === '*' ? 'every hour' : `${v.padStart(2, '0')}:xx`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Day of month</label>
            <input value={dom} onChange={(e) => update({ dom: e.target.value })} placeholder="*" className={cn(inputCls, 'w-full')} />
          </div>
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Month</label>
            <input value={month} onChange={(e) => update({ month: e.target.value })} placeholder="*" className={cn(inputCls, 'w-full')} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Day of week</label>
            <select value={dow} onChange={(e) => update({ dow: e.target.value })} className={cn(inputCls, 'w-full')}>
              {DOW_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
              ))}
            </select>
          </div>
          <p className="col-span-2 text-xs text-[var(--color-fg-subtle)] font-mono">
            → <span className="text-[var(--color-fg-secondary)]">{value || '0 2 * * *'}</span>
          </p>
        </div>
      ) : (
        <div>
          <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Raw schedule expression</label>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => onChange(raw)}
            placeholder="e.g. 0 2 * * mon..fri"
            className={cn(inputCls, 'w-full font-mono')}
          />
          <p className="text-xs text-[var(--color-fg-faint)] mt-1">
            PVE-extended cron: `*/N` shortcuts, ranges (`1-5`), lists (`mon,wed,fri`), and `mon..fri` keywords.
          </p>
        </div>
      )}
    </div>
  );
}

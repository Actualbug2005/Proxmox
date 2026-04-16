'use client';

/**
 * Shared RRD (round-robin database) chart primitive.
 *
 * Used by NodeMetricsChart and VMMetricsChart. Both surfaces render a stack of
 * AreaCharts with identical styling, tooltip, and timeframe controls — only
 * the data source and which series to draw differ. This module owns the
 * styling; wrappers just fetch data and hand it in.
 */
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { formatBytes } from '@/lib/utils';

export type Timeframe = 'hour' | 'day' | 'week';

export interface RRDPoint {
  time: number;
  cpu?: number;
  memused?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
}

export type MetricKey = 'CPU' | 'Memory' | 'Net In' | 'Net Out' | 'Disk Read' | 'Disk Write';

export interface SeriesSpec {
  /** Section label shown above the chart */
  label: string;
  /** One or more metric keys to draw as stacked areas */
  keys: MetricKey[];
  /** Stroke / gradient colour per key */
  colors: string[];
  /** Unique gradient ids (must be stable + unique across the page) */
  gradIds: string[];
  /** Optional Y-axis formatter override (default: formatBytes) */
  formatter?: (v: number) => string;
  /** Show a Legend (e.g. for multi-series charts like Network / Disk) */
  showLegend?: boolean;
  /** Optional Y-axis domain override */
  domain?: [number, number];
}

interface RRDChartProps {
  title: string;
  subtitle: string;
  data: RRDPoint[] | undefined;
  isLoading: boolean;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  series: SeriesSpec[];
}

function formatTime(ts: number, timeframe: Timeframe): string {
  const d = new Date(ts * 1000);
  if (timeframe === 'week') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface TooltipPoint {
  name: string;
  value: number;
  color: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPoint[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-3 text-xs shadow-lg">
      <p className="text-zinc-400 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-zinc-400">{p.name}:</span>
          <span className="text-white font-mono">
            {p.name === 'CPU' ? `${(p.value * 100).toFixed(1)}%` : formatBytes(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RRDChart({
  title,
  subtitle,
  data,
  isLoading,
  timeframe,
  onTimeframeChange,
  series,
}: RRDChartProps) {
  const chartData = (data ?? []).map((d) => ({
    time: formatTime(d.time, timeframe),
    CPU: d.cpu ?? 0,
    Memory: d.memused ?? 0,
    'Net In': d.netin ?? 0,
    'Net Out': d.netout ?? 0,
    'Disk Read': d.diskread ?? 0,
    'Disk Write': d.diskwrite ?? 0,
  }));

  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        <div className="flex gap-1">
          {(['hour', 'day', 'week'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                timeframe === tf
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tf === 'hour' ? '1h' : tf === 'day' ? '24h' : '7d'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {series.map((s) => {
            const isCpu = s.keys[0] === 'CPU';
            const yDomain: [number, number] | undefined = s.domain ?? (isCpu ? [0, 1] : undefined);
            const formatter = s.formatter ?? (isCpu ? (v: number) => `${(v * 100).toFixed(0)}%` : (v: number) => formatBytes(v));
            return (
              <div key={s.label}>
                <p className="text-xs text-zinc-500 mb-2">{s.label}</p>
                <ResponsiveContainer width="100%" height={80}>
                  <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      {s.colors.map((color, i) => (
                        <linearGradient key={s.gradIds[i]} id={s.gradIds[i]} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      tickLine={false}
                      tickFormatter={formatter}
                      domain={yDomain}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    {s.showLegend && <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }} />}
                    {s.keys.map((key, i) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={s.colors[i]}
                        strokeWidth={1.5}
                        fill={`url(#${s.gradIds[i]})`}
                        dot={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

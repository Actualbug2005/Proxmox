'use client';

/**
 * Shared RRD (round-robin database) chart primitive.
 *
 * Used by NodeMetricsChart and VMMetricsChart. Both surfaces render a stack of
 * AreaCharts with identical styling, tooltip, and timeframe controls — only
 * the data source and which series to draw differ. This module owns the
 * styling; wrappers just fetch data and hand it in.
 *
 * Tier 5 Phase 4 extension: opt-in Holt's-linear forecast overlay on CPU and
 * Memory series. Callers that want the overlay pass `forecastHorizon` +
 * `onForecastHorizonChange`; consumers that don't are unaffected.
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
  ReferenceLine,
  Label,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { forecast, type ForecastSample } from '@/lib/forecast';

export type Timeframe = 'hour' | 'day' | 'week';

export type ForecastHorizon = 'off' | '24h' | '7d' | '30d';

export const HORIZON_SECONDS: Record<ForecastHorizon, number> = {
  off: 0,
  '24h': 86400,
  '7d': 86400 * 7,
  '30d': 86400 * 30,
};

const OPACITY_BY_CONFIDENCE = { low: 0.3, medium: 0.6, high: 0.9 } as const;

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
  /** Active horizon — when not 'off', CPU + Memory series get a dashed forecast overlay. */
  forecastHorizon?: ForecastHorizon;
  /** When provided, renders the horizon-selector pill row. */
  onForecastHorizonChange?: (h: ForecastHorizon) => void;
  /** Optional thresholds to mark on forecast line, keyed by metric label. */
  forecastThresholds?: Partial<Record<'CPU' | 'Memory', number>>;
}

function formatTime(ts: number, timeframe: Timeframe): string {
  const d = new Date(ts * 1000);
  if (timeframe === 'week') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Extract forecast-ready samples for a given RRD metric, preserving sample
 * timestamps and dropping only rows that lack the metric entirely. Zero is
 * kept intentionally — an idle-but-live node reports 0% CPU and is still
 * forecastable. This helper is exported for unit testing.
 */
export function extractForecastSamples(
  data: ReadonlyArray<RRDPoint>,
  metric: 'cpu' | 'memused',
): ForecastSample[] {
  const out: ForecastSample[] = [];
  for (const d of data) {
    const v = d[metric];
    if (v === undefined || v === null) continue;
    out.push({ t: d.time, v });
  }
  return out;
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
    <div className="studio-card p-3 text-xs shadow-lg">
      <p className="text-[var(--color-fg-muted)] mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-[var(--color-fg-muted)]">{p.name}:</span>
          <span className="text-white font-mono">
            {p.name.startsWith('CPU') ? `${(p.value * 100).toFixed(1)}%` : formatBytes(p.value)}
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
  forecastHorizon = 'off',
  onForecastHorizonChange,
  forecastThresholds,
}: RRDChartProps) {
  const rrdPoints = data ?? [];
  const chartData = rrdPoints.map((d) => ({
    time: formatTime(d.time, timeframe),
    CPU: d.cpu ?? 0,
    Memory: d.memused ?? 0,
    'Net In': d.netin ?? 0,
    'Net Out': d.netout ?? 0,
    'Disk Read': d.diskread ?? 0,
    'Disk Write': d.diskwrite ?? 0,
  }));

  return (
    <div className="studio-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs text-[var(--color-fg-subtle)]">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            {(['hour', 'day', 'week'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  timeframe === tf
                    ? 'bg-white/10 text-indigo-400'
                    : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]'
                }`}
              >
                {tf === 'hour' ? '1h' : tf === 'day' ? '24h' : '7d'}
              </button>
            ))}
          </div>
          {onForecastHorizonChange && (
            <div className="flex gap-1" aria-label="Forecast horizon">
              {(['off', '24h', '7d', '30d'] as ForecastHorizon[]).map((h) => (
                <button
                  key={h}
                  onClick={() => onForecastHorizonChange(h)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    forecastHorizon === h
                      ? 'bg-white/10 text-indigo-400'
                      : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]'
                  }`}
                >
                  {h === 'off' ? 'forecast off' : h}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
        </div>
      ) : (
        <div className="space-y-4">
          {series.map((s) => {
            const isCpu = s.keys[0] === 'CPU';
            const isMem = s.keys[0] === 'Memory';
            const yDomain: [number, number] | undefined = s.domain ?? (isCpu ? [0, 1] : undefined);
            const formatter = s.formatter ?? (isCpu ? (v: number) => `${(v * 100).toFixed(0)}%` : (v: number) => formatBytes(v));

            // Forecast overlay — CPU + Memory only, and only when horizon active.
            const forecastEligible = (isCpu || isMem) && forecastHorizon !== 'off';
            const metricKey: 'CPU' | 'Memory' | null = isCpu ? 'CPU' : isMem ? 'Memory' : null;
            const rrdField: 'cpu' | 'memused' | null = isCpu ? 'cpu' : isMem ? 'memused' : null;

            let fSeries: ReturnType<typeof forecast> = null;
            if (forecastEligible && rrdField) {
              const samples = extractForecastSamples(rrdPoints, rrdField);
              const threshold = metricKey && forecastThresholds?.[metricKey];
              fSeries = forecast({
                samples,
                horizonSeconds: HORIZON_SECONDS[forecastHorizon],
                thresholds: threshold ? [threshold] : [],
              });
            }

            const forecastKey = metricKey ? `${metricKey} (forecast)` : null;
            const combinedData: Array<Record<string, string | number | null>> = chartData.map((row) => ({ ...row }));
            if (fSeries && forecastKey && metricKey) {
              // Bridge point: repeat the last historical value on the forecast
              // axis so the dashed line visually connects to the solid area.
              const bridgeIdx = combinedData.length - 1;
              if (bridgeIdx >= 0) {
                const lastHistorical = combinedData[bridgeIdx][metricKey];
                if (typeof lastHistorical === 'number') {
                  combinedData[bridgeIdx][forecastKey] = lastHistorical;
                }
              }
              for (const p of fSeries.points) {
                combinedData.push({
                  time: formatTime(p.t, timeframe),
                  [forecastKey]: p.v,
                });
              }
            }

            const overlayStroke = s.colors[0];
            const overlayOpacity = fSeries ? OPACITY_BY_CONFIDENCE[fSeries.confidence] : 0;

            return (
              <div key={s.label}>
                <p className="text-xs text-[var(--color-fg-subtle)] mb-2">{s.label}</p>
                <ResponsiveContainer width="100%" height={80}>
                  <AreaChart data={combinedData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
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
                        connectNulls={false}
                      />
                    ))}
                    {fSeries && forecastKey && (
                      <Area
                        key={forecastKey}
                        type="monotone"
                        dataKey={forecastKey}
                        stroke={overlayStroke}
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        strokeOpacity={overlayOpacity}
                        fill="transparent"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    )}
                    {fSeries?.crossings.map((c) => (
                      <ReferenceLine
                        key={`${c.threshold}-${c.at}`}
                        x={formatTime(c.at, timeframe)}
                        stroke="#ef4444"
                        strokeDasharray="2 2"
                      >
                        <Label
                          value={`Proj ${isCpu ? `${(c.threshold * 100).toFixed(0)}%` : formatBytes(c.threshold)}`}
                          position="top"
                          fontSize={10}
                          fill="#ef4444"
                        />
                      </ReferenceLine>
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

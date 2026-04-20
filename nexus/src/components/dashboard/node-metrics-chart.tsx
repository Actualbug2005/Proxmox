'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useNodeRRD } from '@/hooks/use-cluster';
import type { Timeframe, SeriesSpec, ForecastHorizon } from './rrd-chart';

// Lazy-load — see vm-metrics-chart.tsx for the rationale (recharts ~100KB).
const RRDChart = dynamic(() => import('./rrd-chart').then((m) => ({ default: m.RRDChart })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-48 studio-card">
      <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
    </div>
  ),
});

interface NodeMetricsChartProps {
  nodeName: string;
}

export function NodeMetricsChart({ nodeName }: NodeMetricsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('hour');
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>('off');
  const { data, isLoading } = useNodeRRD(nodeName, timeframe);

  const series = useMemo<SeriesSpec[]>(
    () => [
      {
        label: 'CPU Usage',
        keys: ['CPU'],
        colors: ['#818cf8'],
        gradIds: [`node-${nodeName}-cpu`],
      },
      {
        label: 'Memory',
        keys: ['Memory'],
        colors: ['#3b82f6'],
        gradIds: [`node-${nodeName}-mem`],
      },
      {
        label: 'Network I/O',
        keys: ['Net In', 'Net Out'],
        colors: ['#10b981', '#8b5cf6'],
        gradIds: [`node-${nodeName}-netin`, `node-${nodeName}-netout`],
        showLegend: true,
      },
    ],
    [nodeName],
  );

  return (
    <RRDChart
      title={`${nodeName} — Metrics`}
      subtitle="CPU · Memory · Network"
      data={data}
      isLoading={isLoading}
      timeframe={timeframe}
      onTimeframeChange={setTimeframe}
      series={series}
      forecastHorizon={forecastHorizon}
      onForecastHorizonChange={setForecastHorizon}
    />
  );
}

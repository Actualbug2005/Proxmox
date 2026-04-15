'use client';

import { useState, useMemo } from 'react';
import { useNodeRRD } from '@/hooks/use-cluster';
import { RRDChart, type Timeframe, type SeriesSpec } from './rrd-chart';

interface NodeMetricsChartProps {
  nodeName: string;
}

export function NodeMetricsChart({ nodeName }: NodeMetricsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('hour');
  const { data, isLoading } = useNodeRRD(nodeName, timeframe);

  const series = useMemo<SeriesSpec[]>(
    () => [
      {
        label: 'CPU Usage',
        keys: ['CPU'],
        colors: ['#f97316'],
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
    />
  );
}

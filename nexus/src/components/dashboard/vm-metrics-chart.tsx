'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/proxmox-client';
import type { Timeframe, SeriesSpec, ForecastHorizon } from './rrd-chart';
import { POLL_INTERVALS } from '@/hooks/use-cluster';

// Lazy-load the recharts-heavy implementation. recharts is ~100KB gz; this
// keeps it out of the initial bundle for VM/CT/node detail pages until the
// user actually opens the metrics tab.
const RRDChart = dynamic(() => import('./rrd-chart').then((m) => ({ default: m.RRDChart })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-48 studio-card">
      <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
    </div>
  ),
});

interface VMMetricsChartProps {
  node: string;
  vmid: number;
  type: 'qemu' | 'lxc';
}

export function VMMetricsChart({ node, vmid, type }: VMMetricsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('hour');
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>('off');

  const { data, isLoading } = useQuery({
    queryKey: [type === 'qemu' ? 'vm' : 'ct', node, vmid, 'rrd', timeframe],
    queryFn: () =>
      type === 'qemu'
        ? api.vms.rrd(node, vmid, timeframe)
        : api.containers.rrd(node, vmid, timeframe),
    refetchInterval: POLL_INTERVALS.rrd,
  });

  const series = useMemo<SeriesSpec[]>(
    () => {
      const prefix = `${type}-${node}-${vmid}`;
      return [
        {
          label: 'CPU Usage',
          keys: ['CPU'],
          colors: ['#818cf8'],
          gradIds: [`${prefix}-cpu`],
        },
        {
          label: 'Memory',
          keys: ['Memory'],
          colors: ['#3b82f6'],
          gradIds: [`${prefix}-mem`],
        },
        {
          label: 'Network I/O',
          keys: ['Net In', 'Net Out'],
          colors: ['#10b981', '#8b5cf6'],
          gradIds: [`${prefix}-netin`, `${prefix}-netout`],
          showLegend: true,
        },
        {
          label: 'Disk I/O',
          keys: ['Disk Read', 'Disk Write'],
          colors: ['#f59e0b', '#ec4899'],
          gradIds: [`${prefix}-diskr`, `${prefix}-diskw`],
          showLegend: true,
        },
      ];
    },
    [type, node, vmid],
  );

  return (
    <RRDChart
      title="Metrics"
      subtitle="CPU · Memory · Network · Disk"
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

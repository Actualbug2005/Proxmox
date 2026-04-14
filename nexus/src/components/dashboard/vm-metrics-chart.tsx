'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { formatBytes } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

type Timeframe = 'hour' | 'day' | 'week';

interface VMMetricsChartProps {
  node: string;
  vmid: number;
  type: 'qemu' | 'lxc';
}

function formatTime(ts: number, timeframe: Timeframe): string {
  const d = new Date(ts * 1000);
  if (timeframe === 'hour') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timeframe === 'day') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-lg">
      <p className="text-gray-400 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="text-white font-mono">
            {p.name === 'CPU' ? `${(p.value * 100).toFixed(1)}%` : formatBytes(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export function VMMetricsChart({ node, vmid, type }: VMMetricsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('hour');

  const { data, isLoading } = useQuery({
    queryKey: [type === 'qemu' ? 'vm' : 'ct', node, vmid, 'rrd', timeframe],
    queryFn: () =>
      type === 'qemu'
        ? api.vms.rrd(node, vmid, timeframe)
        : api.containers.rrd(node, vmid, timeframe),
    refetchInterval: 30_000,
  });

  const chartData = (data ?? []).map((d) => ({
    time: formatTime(d.time, timeframe),
    CPU: d.cpu ?? 0,
    Memory: d.memused ?? 0,
    'Net In': d.netin ?? 0,
    'Net Out': d.netout ?? 0,
    'Disk Read': d.diskread ?? 0,
    'Disk Write': d.diskwrite ?? 0,
  }));

  const charts: { label: string; keys: string[]; colors: string[]; gradIds: string[]; formatter?: (v: number) => string }[] = [
    {
      label: 'CPU Usage',
      keys: ['CPU'],
      colors: ['#f97316'],
      gradIds: ['vmCpuGrad'],
      formatter: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: 'Memory',
      keys: ['Memory'],
      colors: ['#3b82f6'],
      gradIds: ['vmMemGrad'],
    },
    {
      label: 'Network I/O',
      keys: ['Net In', 'Net Out'],
      colors: ['#10b981', '#8b5cf6'],
      gradIds: ['vmNetInGrad', 'vmNetOutGrad'],
    },
    {
      label: 'Disk I/O',
      keys: ['Disk Read', 'Disk Write'],
      colors: ['#f59e0b', '#ec4899'],
      gradIds: ['vmDiskReadGrad', 'vmDiskWriteGrad'],
    },
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Metrics</h3>
          <p className="text-xs text-gray-500">CPU · Memory · Network · Disk</p>
        </div>
        <div className="flex gap-1">
          {(['hour', 'day', 'week'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                timeframe === tf ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300'
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
          {charts.map((chart) => (
            <div key={chart.label}>
              <p className="text-xs text-gray-500 mb-2">{chart.label}</p>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    {chart.colors.map((color, i) => (
                      <linearGradient key={chart.gradIds[i]} id={chart.gradIds[i]} x1="0" y1="0" x2="0" y2="1">
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
                    tickFormatter={chart.formatter ?? ((v) => formatBytes(v))}
                    domain={chart.keys[0] === 'CPU' ? [0, 1] : undefined}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {chart.keys.map((key, i) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={chart.colors[i]}
                      strokeWidth={1.5}
                      fill={`url(#${chart.gradIds[i]})`}
                      dot={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

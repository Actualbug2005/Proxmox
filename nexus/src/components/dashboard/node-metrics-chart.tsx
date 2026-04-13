'use client';

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
import { useNodeRRD } from '@/hooks/use-cluster';
import { formatBytes } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

type Timeframe = 'hour' | 'day' | 'week';

interface NodeMetricsChartProps {
  nodeName: string;
}

function formatTime(ts: number, timeframe: Timeframe): string {
  const d = new Date(ts * 1000);
  if (timeframe === 'hour') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timeframe === 'day') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const CustomTooltip = ({
  active,
  payload,
  label,
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

export function NodeMetricsChart({ nodeName }: NodeMetricsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('hour');
  const { data, isLoading } = useNodeRRD(nodeName, timeframe);

  const chartData = data?.map((d) => ({
    time: formatTime(d.time, timeframe),
    CPU: d.cpu ?? 0,
    Memory: d.memused ?? 0,
    'Net In': d.netin ?? 0,
    'Net Out': d.netout ?? 0,
  })) ?? [];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">{nodeName} — Metrics</h3>
          <p className="text-xs text-gray-500">CPU · Memory · Network</p>
        </div>
        <div className="flex gap-1">
          {(['hour', 'day', 'week'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                timeframe === tf
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-gray-500 hover:text-gray-300'
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
          {/* CPU */}
          <div>
            <p className="text-xs text-gray-500 mb-2">CPU Usage</p>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  tickLine={false}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  domain={[0, 1]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="CPU"
                  stroke="#f97316"
                  strokeWidth={1.5}
                  fill="url(#cpuGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Memory */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Memory</p>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  tickLine={false}
                  tickFormatter={(v) => formatBytes(v)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="Memory"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  fill="url(#memGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Network */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Network I/O</p>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="netInGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="netOutGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  tickLine={false}
                  tickFormatter={(v) => formatBytes(v)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }} />
                <Area
                  type="monotone"
                  dataKey="Net In"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  fill="url(#netInGrad)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="Net Out"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  fill="url(#netOutGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

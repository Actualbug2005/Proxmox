/**
 * Pure pressure-aggregation for the NOC view.
 *
 * Takes the cluster snapshot + per-node status lookups + recent tasks,
 * returns the derived totals, top-N hottest guests, and recent failures.
 * No I/O, no React. Component-level code calls computePressure() with
 * already-fetched data.
 */

import { isTaskTerminal, type ClusterResourcePublic, type NodeStatus, type PVETask } from '@/types/proxmox';

export interface TopGuest {
  id: string;
  name?: string;
  node?: string;
  vmid?: number;
  type: 'qemu' | 'lxc';
  /** 0..1 for cpu; 0..1 memPct for memory. */
  value: number;
}

export interface RecentFailure {
  upid: string;
  node: string;
  type: string;
  id?: string;
  user: string;
  exitstatus: string;
  starttime: number;
  /** Always set — a failure by definition has reached a terminal state. */
  endtime: number;
}

export interface ClusterPressure {
  nodesOnline: number;
  nodesTotal: number;
  runningGuests: number;
  totalGuests: number;
  /** Average CPU pressure across online nodes, 0..1. */
  avgCpu: number;
  /** Average memory utilization across online nodes, 0..1. */
  avgMemory: number;
  /** Max 1-minute load / maxCores across online nodes. Undefined when no status data. */
  peakLoadavgPerCore?: number;
  topGuestsByCpu: TopGuest[];
  topGuestsByMemory: TopGuest[];
  recentFailures: RecentFailure[];
}

function parseLoadavg1(status: NodeStatus | undefined): number | undefined {
  const raw = status?.loadavg?.[0];
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function computePressure(
  resources: ReadonlyArray<ClusterResourcePublic>,
  nodeStatuses: Record<string, NodeStatus | undefined>,
  tasks: ReadonlyArray<PVETask>,
  topN = 5,
): ClusterPressure {
  const nodes = resources.filter((r) => r.type === 'node');
  const guests = resources.filter((r) => r.type === 'qemu' || r.type === 'lxc');
  const onlineNodes = nodes.filter((n) => n.status === 'online');
  const runningGuests = guests.filter((g) => g.status === 'running');

  let cpuSum = 0;
  let memSum = 0;
  let cpuCount = 0;
  let memCount = 0;
  let peakLoadavg: number | undefined;

  for (const n of onlineNodes) {
    if (n.cpu !== undefined) {
      cpuSum += n.cpu;
      cpuCount += 1;
    }
    if (n.mem !== undefined && n.maxmem && n.maxmem > 0) {
      memSum += n.mem / n.maxmem;
      memCount += 1;
    }
    const name = n.node ?? n.id;
    const load1 = parseLoadavg1(nodeStatuses[name]);
    const cores = n.maxcpu ?? 0;
    if (load1 !== undefined && cores > 0) {
      const perCore = load1 / cores;
      if (peakLoadavg === undefined || perCore > peakLoadavg) peakLoadavg = perCore;
    }
  }

  const avgCpu = cpuCount > 0 ? cpuSum / cpuCount : 0;
  const avgMemory = memCount > 0 ? memSum / memCount : 0;

  // Rank running guests by CPU pressure and memory pressure (separate
  // rankings — a guest can appear on both lists). Stopped guests have
  // zero pressure and are excluded.
  const byCpu: TopGuest[] = runningGuests
    .filter((g) => g.cpu !== undefined)
    .map((g) => ({
      id: g.id,
      name: g.name,
      node: g.node,
      vmid: g.vmid,
      type: (g.type === 'qemu' ? 'qemu' : 'lxc') as 'qemu' | 'lxc',
      value: g.cpu ?? 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);

  const byMem: TopGuest[] = runningGuests
    .filter((g) => g.mem !== undefined && g.maxmem !== undefined && g.maxmem > 0)
    .map((g) => ({
      id: g.id,
      name: g.name,
      node: g.node,
      vmid: g.vmid,
      type: (g.type === 'qemu' ? 'qemu' : 'lxc') as 'qemu' | 'lxc',
      value: (g.mem ?? 0) / (g.maxmem ?? 1),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);

  // Recent failures: exitstatus present AND not 'OK'. Newest first.
  // `isTaskTerminal` narrows to the TerminalPVETask variant so endtime/
  // exitstatus are compile-time-guaranteed.
  const recentFailures: RecentFailure[] = tasks
    .filter(isTaskTerminal)
    .filter((t) => t.exitstatus !== 'OK')
    .map((t) => ({
      upid: t.upid,
      node: t.node,
      type: t.type,
      id: t.id,
      user: t.user,
      exitstatus: t.exitstatus,
      starttime: t.starttime,
      endtime: t.endtime,
    }))
    .sort((a, b) => b.starttime - a.starttime)
    .slice(0, 10);

  return {
    nodesOnline: onlineNodes.length,
    nodesTotal: nodes.length,
    runningGuests: runningGuests.length,
    totalGuests: guests.length,
    avgCpu,
    avgMemory,
    peakLoadavgPerCore: peakLoadavg,
    topGuestsByCpu: byCpu,
    topGuestsByMemory: byMem,
    recentFailures,
  };
}

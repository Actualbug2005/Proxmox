/**
 * Pure DRS planner — cluster state + policy → optional migration plan.
 *
 * No I/O. Takes the cluster snapshot, runs a three-step funnel, and
 * returns a single proposed move or null:
 *
 *   1. Identify hot nodes (absolute OR clearly-above-cluster-mean).
 *   2. For each eligible guest on the hottest node:
 *        - skip templates and non-running guests
 *        - skip guests with the pinned tag
 *        - skip guests currently in the cooldown window
 *        - score every other online node as a migration target
 *   3. Pick the (guest, target) pair with the biggest score delta
 *      that clears the hysteresis threshold; return it.
 *
 * Tests pin every branch so a regression in "hot node" or "cooldown"
 * logic can't silently let ping-pong back in.
 */

import type { ClusterResourcePublic, NodeStatus } from '../../types/proxmox.ts';
import { parseTagList } from '../resource-grouping.ts';
import {
  scoreTargets,
  type GuestResourceAsk,
  type NodeSnapshot,
  type ScoredTarget,
} from '../migration-score.ts';
import type { DrsPlan, DrsPolicy } from './types.ts';

export interface PlannerInput {
  resources: readonly ClusterResourcePublic[];
  nodeStatuses: Record<string, NodeStatus | undefined>;
  policy: DrsPolicy;
  cooldowns: Record<string, number>;
  now: number;
}

// ─── Step 1: hot node selection ────────────────────────────────────────────

function nodeSnapshots(
  resources: readonly ClusterResourcePublic[],
  nodeStatuses: Record<string, NodeStatus | undefined>,
): NodeSnapshot[] {
  return resources
    .filter((r) => r.type === 'node')
    .map((n): NodeSnapshot => {
      const name = n.node ?? n.id;
      const status = nodeStatuses[name];
      const load1 = Number.parseFloat(status?.loadavg?.[0] ?? '');
      return {
        name,
        online: n.status === 'online',
        maxCores: n.maxcpu ?? 0,
        cpu: n.cpu ?? 0,
        maxMemory: n.maxmem ?? 0,
        memory: n.mem ?? 0,
        loadavg1: Number.isFinite(load1) ? load1 : undefined,
      };
    });
}

/**
 * Return the hottest node if any, else null. "Hot" means both
 * conditions from the policy's hot-test are true:
 *   - at least one of (CPU, mem) is above its absolute threshold
 *   - the node's pressure exceeds the cluster mean by >= relativeDelta
 */
function selectHotNode(
  nodes: NodeSnapshot[],
  policy: DrsPolicy,
): NodeSnapshot | null {
  const online = nodes.filter((n) => n.online);
  if (online.length < 2) return null; // nowhere to move to

  const meanCpu = online.reduce((a, n) => a + n.cpu, 0) / online.length;
  const meanMem =
    online.reduce((a, n) => a + (n.maxMemory > 0 ? n.memory / n.maxMemory : 0), 0)
    / online.length;

  let best: { node: NodeSnapshot; excess: number } | null = null;
  for (const n of online) {
    const cpuAbsHot = n.cpu > policy.hotCpuAbs;
    const memFraction = n.maxMemory > 0 ? n.memory / n.maxMemory : 0;
    const memAbsHot = memFraction > policy.hotMemAbs;
    if (!cpuAbsHot && !memAbsHot) continue;

    const cpuExcess = n.cpu - meanCpu;
    const memExcess = memFraction - meanMem;
    const maxExcess = Math.max(cpuExcess, memExcess);
    if (maxExcess < policy.relativeDelta) continue;

    // Tie-break across multiple hot nodes: pick the one farthest from
    // the cluster mean, not just the hottest absolute value. A node
    // that's 0.05 above mean in a 0.3-mean cluster is less interesting
    // than a node that's 0.30 above mean in a 0.4-mean cluster.
    if (!best || maxExcess > best.excess) best = { node: n, excess: maxExcess };
  }
  return best?.node ?? null;
}

// ─── Step 2: eligible guest filter ──────────────────────────────────────────

interface EligibleGuest {
  vmid: number;
  sourceNode: string;
  cores: number;
  memoryBytes: number;
}

function eligibleGuestsOn(
  nodeName: string,
  resources: readonly ClusterResourcePublic[],
  policy: DrsPolicy,
  cooldowns: Record<string, number>,
  now: number,
): EligibleGuest[] {
  const out: EligibleGuest[] = [];
  for (const r of resources) {
    if (r.type !== 'qemu' && r.type !== 'lxc') continue;
    if (r.node !== nodeName) continue;
    if (r.status !== 'running') continue;
    if (r.template) continue; // templates can't be migrated in the usual sense
    if (typeof r.vmid !== 'number') continue;

    // Pinned-tag opt-out. Operators set this when a guest MUST stay put
    // (e.g. has a GPU passthrough bound to the source node).
    const tags = parseTagList(r.tags);
    if (tags.includes(policy.pinnedTag)) continue;

    // Cooldown: don't re-migrate a guest within the configured window.
    const lastMoved = cooldowns[String(r.vmid)];
    if (lastMoved !== undefined && now - lastMoved < policy.cooldownMin * 60_000) continue;

    out.push({
      vmid: r.vmid,
      sourceNode: nodeName,
      cores: r.maxcpu ?? 0,
      memoryBytes: r.maxmem ?? 0,
    });
  }
  return out;
}

// ─── Step 3: best (guest, target) pair ──────────────────────────────────────

interface GuestMovePlan {
  guest: EligibleGuest;
  target: ScoredTarget;
  delta: number;
}

/**
 * For a single guest, return the best target node + score delta. Uses
 * the existing `scoreTargets` helper to get a 0..100 score per node,
 * then picks the highest above the guest's current (source) node.
 *
 * `null` if no allowed target beats the source by at least the policy's
 * scoreDelta threshold.
 */
function bestTargetFor(
  guest: EligibleGuest,
  nodes: NodeSnapshot[],
  policy: DrsPolicy,
): GuestMovePlan | null {
  const ask: GuestResourceAsk = {
    vmid: guest.vmid,
    cores: guest.cores,
    memoryBytes: guest.memoryBytes,
    sourceNode: guest.sourceNode,
  };
  // No PVE preconditions at this layer — the actual migrate call will
  // hit PVE's precondition endpoint at execute time. The planner scores
  // against headroom only, which is the dominant filter for auto-DRS.
  const scored = scoreTargets(ask, nodes, undefined, new Map());

  // Source node scored too — we need its score to compute the delta.
  const source = scored.find((t) => t.node === guest.sourceNode);
  const sourceScore =
    source && !source.disqualified ? source.score : 0;

  let best: GuestMovePlan | null = null;
  for (const t of scored) {
    if (t.disqualified) continue;
    if (t.node === guest.sourceNode) continue;
    const delta = t.score - sourceScore;
    if (delta < policy.scoreDelta) continue;
    if (!best || delta > best.delta) best = { guest, target: t, delta };
  }
  return best;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute the DRS plan for this tick. Returns `null` when nothing
 * should move — that's the common case on a healthy cluster.
 */
export function planMove(input: PlannerInput): DrsPlan | null {
  const { resources, nodeStatuses, policy, cooldowns, now } = input;

  const nodes = nodeSnapshots(resources, nodeStatuses);
  const hot = selectHotNode(nodes, policy);
  if (!hot) return null;

  const guests = eligibleGuestsOn(hot.name, resources, policy, cooldowns, now);
  if (guests.length === 0) return null;

  // Score each eligible guest and keep the best (guest, target) pair
  // overall. Exhaustive rather than first-fit so the move we pick is
  // the one that relieves the most pressure per migration — a tiny
  // guest moving for a tiny score gain is strictly worse than a big
  // guest moving for a big gain.
  let bestAcross: GuestMovePlan | null = null;
  for (const g of guests) {
    const candidate = bestTargetFor(g, nodes, policy);
    if (!candidate) continue;
    if (!bestAcross || candidate.delta > bestAcross.delta) bestAcross = candidate;
  }
  if (!bestAcross) return null;

  return {
    vmid: bestAcross.guest.vmid,
    sourceNode: bestAcross.guest.sourceNode,
    targetNode: bestAcross.target.node,
    scoreDelta: bestAcross.delta,
    cores: bestAcross.guest.cores,
    memoryBytes: bestAcross.guest.memoryBytes,
  };
}

/** Test-only helpers — not exported from the module barrel. */
export const __internals = {
  selectHotNode,
  eligibleGuestsOn,
  bestTargetFor,
};

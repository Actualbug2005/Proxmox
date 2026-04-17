/**
 * Pure scoring for migration target recommendations.
 *
 * Takes the guest's resource ask (cores + memory bytes + source node),
 * a snapshot of every candidate node's current load, and PVE's
 * precondition output, and returns a ranked list of {score 0..100,
 * disqualified, reasons, fit, label}.
 *
 * Scoring (higher = better, 100 = idle node with full headroom):
 *
 *   score = 100
 *         − cpu_pressure       × 40     (cpu ∈ 0..1 from cluster.resources)
 *         − mem_pressure       × 40     (mem / maxMemory, ∈ 0..1)
 *         − min(loadavg1 / maxCores, 1) × 20
 *
 * Disqualifications (score forced to 0, sorted to the bottom):
 *   - !online
 *   - name === sourceNode
 *   - PVE precondition said not_allowed (reason propagated)
 *   - cpuHeadroomPct < 10%  (after placing the guest)
 *   - memHeadroomPct < 10%
 *
 * Label:
 *   - `recommended` — top non-disqualified (by score)
 *   - `ok`          — score ≥ 60
 *   - `tight`       — score < 60 but not disqualified
 *   - `not-allowed` — disqualified
 *
 * The function is pure. No I/O, no React, no dates. Caller gathers
 * inputs from cluster.resources, per-node status, and the precondition
 * endpoint, then feeds them in.
 */

export interface GuestResourceAsk {
  vmid: number;
  cores: number;
  memoryBytes: number;
  sourceNode: string;
}

export interface NodeSnapshot {
  name: string;
  online: boolean;
  maxCores: number;
  /** Normalised CPU pressure 0..1 from cluster.resources. */
  cpu: number;
  maxMemory: number;
  memory: number;
  /** 1-minute load average as a number, or undefined if unavailable. */
  loadavg1?: number;
}

export type TargetLabel = 'recommended' | 'ok' | 'tight' | 'not-allowed';

export interface ScoredTarget {
  node: string;
  score: number;
  disqualified: boolean;
  reasons: string[];
  fit: {
    cpuHeadroomPct: number;
    memHeadroomPct: number;
  };
  label: TargetLabel;
}

const HEADROOM_FLOOR = 0.1; // 10% — below this the node's too tight after placement

function cpuHeadroomAfterPlacement(node: NodeSnapshot, askCores: number): number {
  if (node.maxCores <= 0) return 0;
  const usedCoresFraction = node.cpu; // already 0..1
  const askFraction = askCores / node.maxCores;
  const totalAfter = usedCoresFraction + askFraction;
  return Math.max(0, 1 - totalAfter);
}

function memHeadroomAfterPlacement(node: NodeSnapshot, askBytes: number): number {
  if (node.maxMemory <= 0) return 0;
  const totalAfter = node.memory + askBytes;
  return Math.max(0, (node.maxMemory - totalAfter) / node.maxMemory);
}

function scoreOne(
  node: NodeSnapshot,
  ask: GuestResourceAsk,
  notAllowedReason: string | undefined,
): ScoredTarget {
  const reasons: string[] = [];
  let disqualified = false;

  if (!node.online) {
    disqualified = true;
    reasons.push('node offline');
  }
  if (node.name === ask.sourceNode) {
    disqualified = true;
    reasons.push('source node');
  }
  if (notAllowedReason) {
    disqualified = true;
    reasons.push(notAllowedReason);
  }

  const cpuHead = cpuHeadroomAfterPlacement(node, ask.cores);
  const memHead = memHeadroomAfterPlacement(node, ask.memoryBytes);

  if (!disqualified) {
    if (cpuHead < HEADROOM_FLOOR) {
      disqualified = true;
      reasons.push(`CPU headroom below ${Math.round(HEADROOM_FLOOR * 100)}%`);
    }
    if (memHead < HEADROOM_FLOOR) {
      disqualified = true;
      reasons.push(`memory headroom below ${Math.round(HEADROOM_FLOOR * 100)}%`);
    }
  }

  let score = 0;
  if (!disqualified) {
    const cpuP = Math.min(Math.max(node.cpu, 0), 1);
    const memP =
      node.maxMemory > 0 ? Math.min(Math.max(node.memory / node.maxMemory, 0), 1) : 1;
    const loadP =
      node.loadavg1 !== undefined && node.maxCores > 0
        ? Math.min(Math.max(node.loadavg1 / node.maxCores, 0), 1)
        : 0;
    score = 100 - cpuP * 40 - memP * 40 - loadP * 20;
    score = Math.max(0, Math.min(100, score));
  }

  return {
    node: node.name,
    score,
    disqualified,
    reasons,
    fit: {
      cpuHeadroomPct: Math.round(cpuHead * 100),
      memHeadroomPct: Math.round(memHead * 100),
    },
    // label is finalised after sort in scoreTargets
    label: disqualified ? 'not-allowed' : score >= 60 ? 'ok' : 'tight',
  };
}

export function scoreTargets(
  ask: GuestResourceAsk,
  nodes: NodeSnapshot[],
  preconditionAllowed: Set<string> | undefined,
  preconditionNotAllowed: Map<string, string>,
): ScoredTarget[] {
  const scored = nodes.map((n) => {
    // Per the PVE precondition semantics: if `allowed_nodes` is present and
    // non-empty, ONLY those nodes are eligible. `not_allowed_nodes` carries
    // explicit reasons. Absence of both = no precondition constraint.
    let notAllowedReason = preconditionNotAllowed.get(n.name);
    if (
      !notAllowedReason &&
      preconditionAllowed &&
      preconditionAllowed.size > 0 &&
      !preconditionAllowed.has(n.name) &&
      n.name !== ask.sourceNode
    ) {
      notAllowedReason = 'PVE precondition excludes this node';
    }
    return scoreOne(n, ask, notAllowedReason);
  });

  // Disqualified rows sink; others sort by score desc.
  scored.sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
    return b.score - a.score;
  });

  // Mark the top non-disqualified as `recommended`.
  const topIdx = scored.findIndex((s) => !s.disqualified);
  if (topIdx >= 0) scored[topIdx].label = 'recommended';

  return scored;
}

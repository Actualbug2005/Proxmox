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

interface BaseScoredTarget {
  node: string;
  reasons: string[];
  fit: {
    cpuHeadroomPct: number;
    memHeadroomPct: number;
  };
}

/** A node that PASSED the precondition + headroom checks. `label` narrows
 *  to one of `'recommended' | 'ok' | 'tight'` and `score` is a real 0..100. */
export interface AllowedScoredTarget extends BaseScoredTarget {
  disqualified: false;
  label: 'recommended' | 'ok' | 'tight';
  score: number;
}

/** A node that was DISQUALIFIED (offline, source, precondition deny, or
 *  insufficient headroom). `label === 'not-allowed'` and `score === 0` are
 *  pinned by the type. */
export interface DisqualifiedScoredTarget extends BaseScoredTarget {
  disqualified: true;
  label: 'not-allowed';
  score: 0;
}

/**
 * Discriminated union: callers narrow with `if (target.disqualified)` and
 * the type system tracks `label`/`score` accordingly. Replaces the
 * previous loose-optional shape where `{ disqualified: true, label: 'ok',
 * score: 70 }` typechecked despite being incoherent.
 */
export type ScoredTarget = AllowedScoredTarget | DisqualifiedScoredTarget;

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

  const fit = {
    cpuHeadroomPct: Math.round(cpuHead * 100),
    memHeadroomPct: Math.round(memHead * 100),
  };

  // Discriminated construction — each branch builds the variant the type
  // system expects. The previous single-object form typechecked against
  // the loose shape but the returned disqualified/label/score tuple could
  // be inconsistent.
  if (disqualified) {
    return { node: node.name, disqualified: true, label: 'not-allowed', score: 0, reasons, fit };
  }
  const cpuP = Math.min(Math.max(node.cpu, 0), 1);
  const memP =
    node.maxMemory > 0 ? Math.min(Math.max(node.memory / node.maxMemory, 0), 1) : 1;
  const loadP =
    node.loadavg1 !== undefined && node.maxCores > 0
      ? Math.min(Math.max(node.loadavg1 / node.maxCores, 0), 1)
      : 0;
  const raw = 100 - cpuP * 40 - memP * 40 - loadP * 20;
  const score = Math.max(0, Math.min(100, raw));
  // label is finalised after sort in scoreTargets — `recommended` is the
  // winner of the first non-disqualified pass.
  return {
    node: node.name,
    disqualified: false,
    label: score >= 60 ? 'ok' : 'tight',
    score,
    reasons,
    fit,
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

  // Mark the top non-disqualified as `recommended`. findIndex loses the
  // narrowing on its return slot, so we re-check before the assignment.
  const topIdx = scored.findIndex((s) => !s.disqualified);
  if (topIdx >= 0) {
    const top = scored[topIdx];
    if (!top.disqualified) top.label = 'recommended';
  }

  return scored;
}

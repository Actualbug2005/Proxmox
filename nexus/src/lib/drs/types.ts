/**
 * Type surface for the Auto-DRS (Distributed Resource Scheduler) loop.
 *
 * DRS observes cluster pressure on a cron tick, identifies an over-
 * pressured node, and picks one guest to migrate to the best-scored
 * target. Every decision is emitted as a `drs.*` event so operators
 * can wire notification rules the same way they'd wire any other
 * alert — no special UI required.
 *
 * Policy storage: single JSON file at ${NEXUS_DATA_DIR}/drs-policy.json.
 * Cooldown state (per-vmid last-moved timestamps) lives alongside the
 * policy so the planner is stateless and a process restart doesn't
 * lose ping-pong protection.
 */

import type { CronExpr } from '../../types/brands.ts';

/**
 * Operating mode. The three-way split means a new cluster can enable
 * DRS in observation-only mode, watch `drs.would.migrate` events roll
 * in for a day, then flip to Enabled once the operator trusts the
 * planner's choices.
 */
export type DrsMode = 'off' | 'dry-run' | 'enabled';

/**
 * The tunable parameters operators edit in the UI. Every field has a
 * sensible default baked into `DEFAULT_POLICY` below; the UI PATCHes
 * only the fields the operator changed.
 */
export interface DrsPolicy {
  mode: DrsMode;

  /**
   * A node is considered "hot" when ALL of:
   *   absolute CPU > hotCpuAbs  OR  absolute mem > hotMemAbs
   *   AND
   *   pressure exceeds cluster mean by >= relativeDelta
   * Both axes must agree so a small cluster where every node is
   * comparably busy doesn't trigger phantom moves.
   */
  hotCpuAbs: number;        // 0..1, default 0.75
  hotMemAbs: number;        // 0..1, default 0.85
  relativeDelta: number;    // fraction above cluster mean, default 0.20

  /**
   * Score-delta hysteresis. A target node must be >= this many score
   * points better than the source before a move is proposed. Values
   * roughly map to: 0 = "any improvement", 20 = "clearly better",
   * 40 = "dramatically better". Default 20 (matches roadmap spec's
   * "0.2" in normalized form — scores are on a 0..100 scale here).
   */
  scoreDelta: number;

  /** Per-guest cooldown window. Once a vmid moves, it can't move
   *  again for this many minutes. Guards against ping-pong between
   *  two chronically-hot nodes. Default 30. */
  cooldownMin: number;

  /**
   * Maximum migrations per scheduler tick (1 minute). 1 keeps the
   * blast radius minimal; an actual storage migration is expensive
   * and cascading them from a single tick would amplify pressure.
   */
  maxPerTick: number;

  /**
   * Blackout cron — ticks that fall inside a matching window are
   * skipped entirely. Empty = no blackout. Uses the same
   * `cron-match.ts` engine as scheduled jobs, so "0 2-6 * * *"
   * (2am-6am daily) works out of the box.
   */
  blackoutCron?: CronExpr;

  /** PVE tag operators can set on a guest to pin it to its current
   *  node. Default 'drs:pinned'. */
  pinnedTag: string;
}

/**
 * On-disk shape. Keeps policy + cooldown state in one file so the
 * planner only reads once per tick.
 */
export interface DrsState {
  version: 1;
  policy: DrsPolicy;
  /** Per-vmid last-migrated timestamp (ms epoch). */
  cooldowns: Record<string, number>;
  /**
   * Last-N records for the UI's "recent actions" panel. Capped server-
   * side on write so the file doesn't grow unbounded.
   */
  history: DrsHistoryEntry[];
}

export interface DrsHistoryEntry {
  at: number;
  mode: DrsMode;
  outcome: 'moved' | 'would-move' | 'skipped' | 'no-action';
  /** Populated when outcome is a move attempt. */
  vmid?: number;
  sourceNode?: string;
  targetNode?: string;
  scoreDelta?: number;
  reason?: string;
}

/** Default values for a never-configured cluster. */
export const DEFAULT_POLICY: DrsPolicy = {
  mode: 'off',
  hotCpuAbs: 0.75,
  hotMemAbs: 0.85,
  relativeDelta: 0.20,
  scoreDelta: 20,
  cooldownMin: 30,
  maxPerTick: 1,
  pinnedTag: 'drs:pinned',
};

/**
 * What the planner returns. `null` = no eligible move this tick; the
 * scheduler source records that as `outcome: 'no-action'` and moves on.
 */
export interface DrsPlan {
  vmid: number;
  sourceNode: string;
  targetNode: string;
  /** `target.score - source.score` — explains why this move was picked. */
  scoreDelta: number;
  /** Guest resource footprint at the moment of planning, for the log. */
  cores: number;
  memoryBytes: number;
}

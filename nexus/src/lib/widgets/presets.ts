/**
 * Bento preset definitions.
 *
 * Four curated layouts the dashboard switches between. Grid is fixed
 * at 4 columns wide; rows auto-expand. Widget ids referenced here
 * must be registered by `register-all.ts` — validatePreset() (unit
 * tests) fails the build if a preset references an unknown widget.
 *
 * Layout grammar:
 *   col:  1-based column start (1..4)
 *   cols: column span (1..4, col+cols-1 must be <= 4)
 *   row:  1-based row start
 *   rows: row span
 *
 * Rows auto-pack: if you leave row 2 empty, CSS grid shrinks the gap.
 * Below the md breakpoint the grid collapses to 1 or 2 columns and
 * cells stack in DOM order, so the cell order here doubles as the
 * mobile reading order.
 */

import type { BentoPreset } from './registry.ts';

export const PRESETS: Record<BentoPreset['id'], BentoPreset> = {
  // ── Overview — familiar daily landing ─────────────────────────────────────
  //  row 1:  [cluster-summary .. spans 4]
  //  row 2:  [node-roster  2x2][recent-tasks 2x2]
  //  row 4:  [pressure-summary  .. spans 4]
  overview: {
    id: 'overview',
    label: 'Overview',
    description: 'Daily landing page — what you check first.',
    cells: [
      { widgetId: 'cluster-summary', col: 1, cols: 4, row: 1, rows: 1 },
      { widgetId: 'node-roster',     col: 1, cols: 2, row: 2, rows: 2 },
      { widgetId: 'recent-tasks',    col: 3, cols: 2, row: 2, rows: 2 },
      { widgetId: 'pressure-summary', col: 1, cols: 4, row: 4, rows: 1 },
    ],
  },

  // ── NOC — active monitoring for on-call ───────────────────────────────────
  //  row 1:  [pressure-summary 2x1][cluster-summary 2x1]
  //  row 2:  [top-offenders 2x2][recent-failures 2x2]
  //  row 4:  [node-roster 4x2]
  noc: {
    id: 'noc',
    label: 'NOC',
    description: 'Active monitoring for on-call.',
    cells: [
      { widgetId: 'pressure-summary', col: 1, cols: 2, row: 1, rows: 1 },
      { widgetId: 'cluster-summary',  col: 3, cols: 2, row: 1, rows: 1 },
      { widgetId: 'top-offenders',    col: 1, cols: 2, row: 2, rows: 2 },
      { widgetId: 'recent-failures',  col: 3, cols: 2, row: 2, rows: 2 },
      { widgetId: 'node-roster',      col: 1, cols: 4, row: 4, rows: 2 },
    ],
  },

  // ── Capacity — planning, headroom, projections ────────────────────────────
  //  row 1:  [cluster-summary 2x1][pressure-summary 2x1]
  //  row 2:  [storage-exhaustion 4x2]
  //  row 4:  [top-offenders 2x2][node-roster 2x2]
  capacity: {
    id: 'capacity',
    label: 'Capacity',
    description: 'Planning, headroom, projections.',
    cells: [
      { widgetId: 'cluster-summary',   col: 1, cols: 2, row: 1, rows: 1 },
      { widgetId: 'pressure-summary',  col: 3, cols: 2, row: 1, rows: 1 },
      { widgetId: 'storage-exhaustion', col: 1, cols: 4, row: 2, rows: 2 },
      { widgetId: 'top-offenders',     col: 1, cols: 2, row: 4, rows: 2 },
      { widgetId: 'node-roster',       col: 3, cols: 2, row: 4, rows: 2 },
    ],
  },

  // ── Incidents — active firefighting ───────────────────────────────────────
  //  row 1:  [guest-trouble 2x2][recent-failures 2x2]
  //  row 3:  [storage-exhaustion 2x2][top-offenders 2x2]
  //  row 5:  [cluster-summary 4x1]
  incidents: {
    id: 'incidents',
    label: 'Incidents',
    description: 'Active firefighting — what needs attention now.',
    cells: [
      { widgetId: 'guest-trouble',      col: 1, cols: 2, row: 1, rows: 2 },
      { widgetId: 'recent-failures',    col: 3, cols: 2, row: 1, rows: 2 },
      { widgetId: 'storage-exhaustion', col: 1, cols: 2, row: 3, rows: 2 },
      { widgetId: 'top-offenders',      col: 3, cols: 2, row: 3, rows: 2 },
      { widgetId: 'cluster-summary',    col: 1, cols: 4, row: 5, rows: 1 },
    ],
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as Array<BentoPreset['id']>;
export const DEFAULT_PRESET_ID: BentoPreset['id'] = 'overview';

export function getPreset(id: string): BentoPreset | undefined {
  return (PRESETS as Record<string, BentoPreset | undefined>)[id];
}

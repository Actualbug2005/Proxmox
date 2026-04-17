/**
 * Bento preset definitions.
 *
 * The four curated layouts the dashboard switches between. Widget ids
 * referenced here must be registered by Phase 2's widget modules —
 * validatePreset() in the unit tests will fail the build if a preset
 * references a widget that isn't registered at module-load time.
 *
 * Grid is 4 columns wide; rows auto-expand. A 2-col widget on col=1
 * occupies cols 1 and 2; a 4-col widget fills the row.
 */

import type { BentoPreset } from './registry.ts';

export const PRESETS: Record<BentoPreset['id'], BentoPreset> = {
  overview: {
    id: 'overview',
    label: 'Overview',
    description: 'Daily landing page — what you check first.',
    cells: [],
  },
  noc: {
    id: 'noc',
    label: 'NOC',
    description: 'Active monitoring for on-call.',
    cells: [],
  },
  capacity: {
    id: 'capacity',
    label: 'Capacity',
    description: 'Planning, headroom, projections.',
    cells: [],
  },
  incidents: {
    id: 'incidents',
    label: 'Incidents',
    description: 'Active firefighting — what needs attention now.',
    cells: [],
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as Array<BentoPreset['id']>;
export const DEFAULT_PRESET_ID: BentoPreset['id'] = 'overview';

export function getPreset(id: string): BentoPreset | undefined {
  return (PRESETS as Record<string, BentoPreset | undefined>)[id];
}

/**
 * Shape of per-user UI preferences.
 *
 * A single document per user, keyed by the authenticated PVE username.
 * The only thing we persist for 7.4 is custom bento layouts — one per
 * preset id — but the document is intentionally extensible so future
 * UX prefs (starred guests, default scope filters, etc) can land here
 * without standing up another store.
 */

import type { BentoCell, BentoPreset } from '../widgets/registry.ts';

/** A custom cell layout for one preset. Same grammar as `BentoCell`. */
export type CustomLayout = BentoCell[];

export interface UserPrefs {
  version: 1;
  /** Preset id → custom cell layout. Missing keys fall back to the
   *  built-in preset in `presets.ts`. */
  bentoLayouts: Partial<Record<BentoPreset['id'], CustomLayout>>;
}

export const EMPTY_PREFS: UserPrefs = {
  version: 1,
  bentoLayouts: {},
};

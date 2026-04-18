/**
 * Auto-update policy — how Nexus self-upgrades from GitHub releases.
 *
 * Three modes, three constraints, three presets. Default `notify`: check
 * on a cadence, emit a notification event if a new release lands, never
 * install unattended. `auto` steps up to unattended installs but caps
 * delta at `autoInstallScope` (patch-only default).
 *
 * Schedule presets are just cron strings; the UI also accepts a free-
 * form expression. The scheduler ticks once a minute and evaluates the
 * cron match itself — no separate timer.
 */

export type UpdatePolicyMode = 'off' | 'notify' | 'auto';

/**
 * SemVer delta that unattended installs are allowed to cross. `patch`
 * caps at 0.22.0 → 0.22.1; `minor` caps at 0.22.x → 0.23.x; `any` lifts
 * the cap entirely. Larger deltas still emit `nexus.update.available`
 * so an operator can drive the install by hand from the UI.
 */
export type AutoInstallScope = 'patch' | 'minor' | 'any';

export type UpdateChannel = 'stable' | 'prerelease';

/** Built-in cron presets — exported for the UI dropdown. */
export const SCHEDULE_PRESETS = {
  production: { cron: '0 9 * * mon', label: 'Production — Mondays 09:00' },
  homelab:    { cron: '0 3 * * sun', label: 'Homelab — Sundays 03:00' },
} as const;
export type SchedulePresetId = keyof typeof SCHEDULE_PRESETS;

export interface UpdatePolicy {
  mode: UpdatePolicyMode;
  channel: UpdateChannel;
  autoInstallScope: AutoInstallScope;
  /** 5-field cron expression gating both checks and auto-installs. */
  cron: string;
  /** Unix ms of the most recent check attempt (any mode). */
  lastCheckedAt?: number;
  /** Last release tag we saw on the wire. Drives "update available" banner
   *  state without re-hitting GitHub on every UI tick. */
  lastSeenTag?: string;
  /** Unix ms of the most recent successful auto-install trigger. Guards
   *  the hard 60-minute floor so a flapping GitHub API can't cause a
   *  restart storm. */
  lastAutoInstallAt?: number;
}

export const DEFAULT_POLICY: UpdatePolicy = {
  mode: 'notify',
  channel: 'stable',
  autoInstallScope: 'patch',
  cron: SCHEDULE_PRESETS.homelab.cron,
};

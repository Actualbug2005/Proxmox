/**
 * SemVer delta classifier. Pure — no I/O, no shell, test-only inputs.
 *
 * Inputs may have a leading `v` and a pre-release suffix. We strip both
 * before comparing the numeric triple. Invalid tags on either side
 * yield `null` so callers can fall back to notify-only without
 * crashing the tick.
 */

import type { AutoInstallScope } from './types.ts';

export type SemverDelta = 'patch' | 'minor' | 'major' | 'same' | 'older';

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?$/;

export function parseSemver(s: string): ParsedSemver | null {
  const m = SEMVER_RE.exec(s.trim());
  if (!m) return null;
  return {
    major: Number.parseInt(m[1], 10),
    minor: Number.parseInt(m[2], 10),
    patch: Number.parseInt(m[3], 10),
  };
}

/**
 * Classify the delta `current -> target`. Returns `null` when either tag
 * fails to parse; callers treat that as unknown delta and fall back to
 * notify-only rather than racing an install.
 */
export function classifyDelta(
  current: string,
  target: string,
): SemverDelta | null {
  const a = parseSemver(current);
  const b = parseSemver(target);
  if (!a || !b) return null;
  if (b.major < a.major) return 'older';
  if (b.major > a.major) return 'major';
  if (b.minor < a.minor) return 'older';
  if (b.minor > a.minor) return 'minor';
  if (b.patch < a.patch) return 'older';
  if (b.patch > a.patch) return 'patch';
  return 'same';
}

/**
 * Does this delta fit inside the configured auto-install scope?
 *   any   — every forward delta
 *   minor — patch + minor
 *   patch — patch only (default)
 * `older` and `same` never qualify.
 */
export function autoInstallAllowed(
  delta: SemverDelta,
  scope: AutoInstallScope,
): boolean {
  if (delta === 'same' || delta === 'older') return false;
  if (scope === 'any') return true;
  if (scope === 'minor') return delta === 'minor' || delta === 'patch';
  return delta === 'patch';
}

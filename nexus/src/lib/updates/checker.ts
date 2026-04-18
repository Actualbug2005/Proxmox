/**
 * Auto-update checker — runs under the shared 60s scheduler tick.
 *
 * Flow each fire:
 *   1. Consult the persisted policy. Mode=off → no-op.
 *   2. Cron must match this minute. If not, no-op.
 *   3. Hit GitHub releases (stable or prerelease channel per policy).
 *   4. Classify the SemVer delta current -> latest.
 *      - same/older: nothing to do (notify on first-seen only).
 *      - forward delta:
 *          * mode=notify: emit `nexus.update.available` once per tag.
 *          * mode=auto with delta in scope:
 *              - safety rails must all pass, OR emit
 *                `nexus.update.deferred`, retry next window.
 *              - run the updater. Emit `installed` on success,
 *                `failed` on non-zero.
 *   5. Record a run-history line under `source=update`.
 *
 * The checker is isolated from I/O specifics by four injected seams:
 *   - readCurrentVersion / fetchLatestRelease: GitHub + disk reads
 *   - getSignals:  snapshots the "is anything in flight?" state
 *   - runInstaller: invokes `nexus-update` (server.ts glue)
 *
 * Pure on every branch that doesn't invoke the injected seams, so
 * tests can pin every decision without spinning up a server.
 */

import { matchesCron } from '../cron-match.ts';
import { emit } from '../notifications/event-bus.ts';
import { appendRun } from '../run-history/store.ts';
import {
  autoInstallAllowed,
  classifyDelta,
  type SemverDelta,
} from './delta.ts';
import {
  getPolicy,
  noteAutoInstall,
  noteCheck,
  updatePolicy,
} from './store.ts';
import type { UpdatePolicy } from './types.ts';

const MIN_AUTO_INSTALL_GAP_MS = 60 * 60_000;

export interface SafetySignals {
  /** Any community-script job currently running? */
  scriptJobsRunning: number;
  /** Is a DRS migration currently in flight (latest history within 10 min)? */
  drsMigrationInFlight: boolean;
  /** Count of active noVNC / xterm relay sockets. */
  activeConsoleSockets: number;
}

export interface CheckerDeps {
  readCurrentVersion: () => Promise<string>;
  fetchLatestRelease: (channel: UpdatePolicy['channel']) => Promise<{
    tag: string;
    url: string;
  } | null>;
  getSignals: () => Promise<SafetySignals>;
  runInstaller: (version: string) => Promise<{ ok: boolean; reason?: string }>;
  now?: () => number;
  /** Override for tests that want to pin a match-minute. */
  clock?: () => Date;
}

export type TickOutcome =
  | 'off'
  | 'cron-miss'
  | 'probe-failed'
  | 'up-to-date'
  | 'notified'
  | 'deferred'
  | 'installed'
  | 'install-failed'
  | 'already-notified';

export interface TickResult {
  outcome: TickOutcome;
  current?: string;
  latest?: string;
  delta?: SemverDelta | null;
  reason?: string;
}

function gateSafetyRails(
  signals: SafetySignals,
  now: number,
  lastAutoInstallAt: number | undefined,
): string | null {
  if (
    lastAutoInstallAt !== undefined &&
    now - lastAutoInstallAt < MIN_AUTO_INSTALL_GAP_MS
  ) {
    const mins = Math.ceil(
      (MIN_AUTO_INSTALL_GAP_MS - (now - lastAutoInstallAt)) / 60_000,
    );
    return `cooling down after previous auto-install (${mins} min remaining)`;
  }
  if (signals.scriptJobsRunning > 0) {
    return `${signals.scriptJobsRunning} script job(s) running`;
  }
  if (signals.drsMigrationInFlight) {
    return 'DRS migration in flight';
  }
  if (signals.activeConsoleSockets > 0) {
    return `${signals.activeConsoleSockets} active console session(s)`;
  }
  return null;
}

export async function runTick(deps: CheckerDeps): Promise<TickResult> {
  const now = deps.now ? deps.now() : Date.now();
  const clock = deps.clock ? deps.clock() : new Date(now);
  const policy = await getPolicy();

  if (policy.mode === 'off') return { outcome: 'off' };
  if (!matchesCron(policy.cron, clock)) return { outcome: 'cron-miss' };

  const current = await deps.readCurrentVersion();
  const latest = await deps.fetchLatestRelease(policy.channel);
  await noteCheck(now, latest?.tag);

  if (!latest || !latest.tag) {
    await appendRun({
      at: now,
      source: 'update',
      sourceId: 'check',
      outcome: 'skipped',
      note: 'release probe failed',
    });
    return { outcome: 'probe-failed', current };
  }

  const delta = classifyDelta(current, latest.tag);
  if (delta === 'same' || delta === null) {
    return { outcome: 'up-to-date', current, latest: latest.tag, delta };
  }
  if (delta === 'older') {
    // Latest on the wire is older than what we're running — probably a
    // dev build or a yanked release. Don't emit anything; appendRun
    // records it for forensics only.
    await appendRun({
      at: now,
      source: 'update',
      sourceId: 'check',
      outcome: 'skipped',
      note: `latest ${latest.tag} older than installed ${current}`,
    });
    return { outcome: 'up-to-date', current, latest: latest.tag, delta };
  }

  const alreadyNotified = policy.lastSeenTag === latest.tag;

  if (policy.mode === 'notify') {
    if (!alreadyNotified) {
      emit({
        kind: 'nexus.update.available',
        at: now,
        payload: {
          current,
          latest: latest.tag,
          delta,
          releaseUrl: latest.url,
        },
      });
      await appendRun({
        at: now,
        source: 'update',
        sourceId: 'check',
        outcome: 'success',
        note: `notify: ${delta} delta ${current} -> ${latest.tag}`,
      });
      return { outcome: 'notified', current, latest: latest.tag, delta };
    }
    return { outcome: 'already-notified', current, latest: latest.tag, delta };
  }

  // mode === 'auto'
  if (!autoInstallAllowed(delta, policy.autoInstallScope)) {
    if (!alreadyNotified) {
      emit({
        kind: 'nexus.update.available',
        at: now,
        payload: {
          current,
          latest: latest.tag,
          delta,
          releaseUrl: latest.url,
          note: `delta ${delta} exceeds auto-install scope ${policy.autoInstallScope}`,
        },
      });
    }
    return { outcome: 'notified', current, latest: latest.tag, delta };
  }

  const signals = await deps.getSignals();
  const blocked = gateSafetyRails(signals, now, policy.lastAutoInstallAt);
  if (blocked) {
    emit({
      kind: 'nexus.update.deferred',
      at: now,
      payload: { current, latest: latest.tag, reason: blocked },
    });
    await appendRun({
      at: now,
      source: 'update',
      sourceId: 'check',
      outcome: 'skipped',
      note: `deferred: ${blocked}`,
    });
    return { outcome: 'deferred', current, latest: latest.tag, delta, reason: blocked };
  }

  // All gates passed — fire the installer.
  const result = await deps.runInstaller(latest.tag);
  if (!result.ok) {
    emit({
      kind: 'nexus.update.failed',
      at: now,
      payload: {
        current,
        target: latest.tag,
        reason: result.reason ?? 'unknown',
      },
    });
    await appendRun({
      at: now,
      source: 'update',
      sourceId: 'check',
      outcome: 'failed',
      error: result.reason,
    });
    return { outcome: 'install-failed', current, latest: latest.tag, delta, reason: result.reason };
  }

  await noteAutoInstall(now);
  // Mark so subsequent ticks don't re-notify on the same tag if the
  // install takes a couple of cycles to propagate through systemd.
  await updatePolicy({ lastSeenTag: latest.tag });
  emit({
    kind: 'nexus.update.installed',
    at: now,
    payload: { previous: current, installed: latest.tag, delta },
  });
  await appendRun({
    at: now,
    source: 'update',
    sourceId: 'check',
    outcome: 'success',
    note: `installed ${latest.tag} (${delta})`,
  });
  return { outcome: 'installed', current, latest: latest.tag, delta };
}

export const __testing = { gateSafetyRails } as const;

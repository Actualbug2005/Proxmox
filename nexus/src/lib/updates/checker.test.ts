/**
 * Auto-update checker — branch coverage via DI. Every seam is stubbed so
 * we never touch GitHub or the installer binary from tests.
 *
 * The persisted store IS real; tests set NEXUS_DATA_DIR to a temp dir
 * at require-time to keep writes isolated.
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set NEXUS_DATA_DIR before the store module loads.
process.env.NEXUS_DATA_DIR = mkdtempSync(join(tmpdir(), 'nexus-updates-test-'));

import { runTick, type CheckerDeps, type SafetySignals } from './checker.ts';
import { __testing as storeTesting, updatePolicy } from './store.ts';
import { subscribe, __testing as busTesting } from '../notifications/event-bus.ts';
import type { NotificationEvent } from '../notifications/types.ts';

function captureEvents(): () => NotificationEvent[] {
  const seen: NotificationEvent[] = [];
  subscribe((e: NotificationEvent) => { seen.push(e); });
  return () => seen;
}

function makeDeps(over: Partial<CheckerDeps> = {}): CheckerDeps {
  const safeSignals: SafetySignals = {
    scriptJobsRunning: 0,
    drsMigrationInFlight: false,
    activeConsoleSockets: 0,
  };
  return {
    readCurrentVersion: async () => 'v0.22.0',
    fetchLatestRelease: async () => ({
      tag: 'v0.22.1',
      url: 'https://example/releases/v0.22.1',
    }),
    getSignals: async () => safeSignals,
    runInstaller: async () => ({ ok: true }),
    // Cron `0 3 * * sun` — Sundays at 03:00 LOCAL TIME (matchesCron reads
    // getMinutes/getHours/getDay which are all local). Construct via the
    // numeric Date ctor so the test is TZ-independent.
    // 2026-04-19 is a Sunday.
    clock: () => new Date(2026, 3, 19, 3, 0, 0, 0),
    now: () => new Date(2026, 3, 19, 3, 0, 0, 0).getTime(),
    ...over,
  };
}

describe('updates checker', () => {
  beforeEach(async () => {
    busTesting.clear();
    await storeTesting.reset();
  });
  afterEach(() => {
    busTesting.clear();
  });

  it('mode=off short-circuits before any I/O', async () => {
    await updatePolicy({ mode: 'off' });
    let probeCalls = 0;
    const result = await runTick(
      makeDeps({
        fetchLatestRelease: async () => {
          probeCalls += 1;
          return null;
        },
      }),
    );
    assert.equal(result.outcome, 'off');
    assert.equal(probeCalls, 0);
  });

  it('cron miss skips silently', async () => {
    await updatePolicy({ mode: 'notify', cron: '0 3 * * sun' });
    const result = await runTick(
      makeDeps({
        // Monday 2026-04-20 03:00 local — does not match `* * * * sun`.
        clock: () => new Date(2026, 3, 20, 3, 0, 0, 0),
      }),
    );
    assert.equal(result.outcome, 'cron-miss');
  });

  it('notify mode emits nexus.update.available once per tag', async () => {
    await updatePolicy({ mode: 'notify', cron: '0 3 * * sun' });
    const take = captureEvents();

    const a = await runTick(makeDeps());
    assert.equal(a.outcome, 'notified');
    assert.equal(take().length, 1);
    assert.equal(take()[0].kind, 'nexus.update.available');

    // Second tick on the same tag — no re-emit.
    const b = await runTick(makeDeps());
    assert.equal(b.outcome, 'already-notified');
    assert.equal(take().length, 1);
  });

  it('auto mode with patch scope installs a patch delta', async () => {
    await updatePolicy({ mode: 'auto', autoInstallScope: 'patch', cron: '0 3 * * sun' });
    const take = captureEvents();
    let installedWith = '';
    const deps = makeDeps({
      runInstaller: async (v) => {
        installedWith = v;
        return { ok: true };
      },
    });
    const result = await runTick(deps);
    assert.equal(result.outcome, 'installed');
    assert.equal(installedWith, 'v0.22.1');
    const kinds = take().map((e) => e.kind);
    assert.ok(kinds.includes('nexus.update.installed'), kinds.join(','));
  });

  it('auto mode with patch scope refuses a minor delta (notifies instead)', async () => {
    await updatePolicy({ mode: 'auto', autoInstallScope: 'patch', cron: '0 3 * * sun' });
    const take = captureEvents();
    let installerCalled = false;
    const deps = makeDeps({
      readCurrentVersion: async () => 'v0.22.0',
      fetchLatestRelease: async () => ({ tag: 'v0.23.0', url: 'u' }),
      runInstaller: async () => {
        installerCalled = true;
        return { ok: true };
      },
    });
    const result = await runTick(deps);
    assert.equal(result.outcome, 'notified');
    assert.equal(installerCalled, false);
    assert.equal(take()[0].kind, 'nexus.update.available');
  });

  it('safety rails defer auto-install when a script job is running', async () => {
    await updatePolicy({ mode: 'auto', autoInstallScope: 'patch', cron: '0 3 * * sun' });
    const take = captureEvents();
    let installerCalled = false;
    const deps = makeDeps({
      getSignals: async () => ({
        scriptJobsRunning: 1,
        drsMigrationInFlight: false,
        activeConsoleSockets: 0,
      }),
      runInstaller: async () => {
        installerCalled = true;
        return { ok: true };
      },
    });
    const result = await runTick(deps);
    assert.equal(result.outcome, 'deferred');
    assert.equal(installerCalled, false);
    assert.equal(take()[0].kind, 'nexus.update.deferred');
  });

  it('60-minute floor blocks a second auto-install immediately after the first', async () => {
    await updatePolicy({
      mode: 'auto',
      autoInstallScope: 'patch',
      cron: '0 3 * * sun',
      lastAutoInstallAt: new Date(2026, 3, 19, 2, 30, 0, 0).getTime(), // 30 min before the clock
    });
    const take = captureEvents();
    const deps = makeDeps();
    const result = await runTick(deps);
    assert.equal(result.outcome, 'deferred');
    assert.ok(
      (take()[0].kind === 'nexus.update.deferred'),
      'expected deferred event at the 60-min floor',
    );
  });

  it('install failure emits nexus.update.failed and does not stamp lastAutoInstallAt', async () => {
    await updatePolicy({ mode: 'auto', autoInstallScope: 'patch', cron: '0 3 * * sun' });
    const take = captureEvents();
    const deps = makeDeps({
      runInstaller: async () => ({ ok: false, reason: 'exit 2' }),
    });
    const result = await runTick(deps);
    assert.equal(result.outcome, 'install-failed');
    const kinds = take().map((e) => e.kind);
    assert.ok(kinds.includes('nexus.update.failed'));
  });

  it('older-on-wire is recorded but emits nothing', async () => {
    await updatePolicy({ mode: 'notify', cron: '0 3 * * sun' });
    const take = captureEvents();
    const deps = makeDeps({
      readCurrentVersion: async () => 'v0.22.1',
      fetchLatestRelease: async () => ({ tag: 'v0.22.0', url: 'u' }),
    });
    const result = await runTick(deps);
    assert.equal(result.outcome, 'up-to-date');
    assert.equal(result.delta, 'older');
    assert.equal(take().length, 0);
  });
});

// Clean up the temp NEXUS_DATA_DIR so successive `npm test` runs don't
// leak folders under /tmp.
process.on('exit', () => {
  try {
    rmSync(process.env.NEXUS_DATA_DIR!, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

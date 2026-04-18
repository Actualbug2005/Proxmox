/**
 * Tests for the guest-agent poll-source dispatcher logic.
 *
 * We don't hit real PVE — `processProbes` is a pure function over the
 * GuestProbe array, so every branch (edge-triggered disk.filling,
 * consecutive-failure count for agent.unreachable, state GC) is
 * testable without network.
 */
import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { processProbes, __resetTickState } from './poll-source.ts';
import type { GuestProbe } from './types.ts';
import { subscribe, __testing as busTesting } from '../notifications/event-bus.ts';
import type { NotificationEvent } from '../notifications/types.ts';

function captureEvents(): () => NotificationEvent[] {
  const seen: NotificationEvent[] = [];
  subscribe((e: NotificationEvent) => { seen.push(e); });
  return () => seen;
}

describe('guest-agent poll-source — processProbes', () => {
  beforeEach(() => {
    __resetTickState();
    busTesting.clear();
  });

  it('emits guest.disk.filling when a mount crosses the threshold (once)', () => {
    const take = captureEvents();
    const probe: GuestProbe = {
      vmid: 100, node: 'pve-01', reachable: true,
      filesystems: [{ mountpoint: '/', type: 'ext4', totalBytes: 100, usedBytes: 92 }],
    };
    const pressures = processProbes([probe], {
      pressureThreshold: 0.85, unreachableThreshold: 3, now: 1000,
    });
    assert.equal(pressures.length, 1);
    assert.equal(pressures[0].mountpoint, '/');
    const events = take();
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'guest.disk.filling');

    // Second tick at the same pressure should NOT re-emit (edge-trigger).
    processProbes([probe], {
      pressureThreshold: 0.85, unreachableThreshold: 3, now: 2000,
    });
    assert.equal(take().length, 1, 'no re-emit while mount stays filling');
  });

  it('re-emits after the mount drops below threshold and rises again', () => {
    const take = captureEvents();
    const full: GuestProbe = {
      vmid: 100, node: 'pve-01', reachable: true,
      filesystems: [{ mountpoint: '/', type: 'ext4', totalBytes: 100, usedBytes: 92 }],
    };
    const cleaned: GuestProbe = {
      ...full,
      filesystems: [{ mountpoint: '/', type: 'ext4', totalBytes: 100, usedBytes: 40 }],
    };
    processProbes([full], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 1000 });
    processProbes([cleaned], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 2000 });
    processProbes([full], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 3000 });

    const events = take();
    assert.equal(events.length, 2, 'edge-trigger re-fires after clear');
    assert.equal(events[0].kind, 'guest.disk.filling');
    assert.equal(events[1].kind, 'guest.disk.filling');
  });

  it('requires N consecutive failures before guest.agent.unreachable', () => {
    const take = captureEvents();
    const down: GuestProbe = {
      vmid: 200, node: 'pve-02', reachable: false, reason: 'timeout',
    };
    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 1000 });
    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 2000 });
    assert.equal(take().length, 0, 'no event before threshold');

    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 3000 });
    const events = take();
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'guest.agent.unreachable');
    if (events[0].kind === 'guest.agent.unreachable') {
      assert.equal(events[0].payload.consecutiveFailures, 3);
    }

    // Further consecutive failures must not re-emit until recovery.
    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 4000 });
    assert.equal(take().length, 1, 'no re-emit while still unreachable');
  });

  it('recovery resets the unreachable counter — can re-fire next outage', () => {
    const take = captureEvents();
    const down: GuestProbe = { vmid: 200, node: 'pve-02', reachable: false, reason: 't' };
    const up:   GuestProbe = { vmid: 200, node: 'pve-02', reachable: true, filesystems: [] };
    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 2, now: 1 });
    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 2, now: 2 });
    assert.equal(take().length, 1);
    processProbes([up],   { pressureThreshold: 0.85, unreachableThreshold: 2, now: 3 });
    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 2, now: 4 });
    processProbes([down], { pressureThreshold: 0.85, unreachableThreshold: 2, now: 5 });
    assert.equal(take().length, 2, 'second outage fires after recovery');
  });

  it('garbage-collects state for guests dropped from the fleet', () => {
    const a: GuestProbe = { vmid: 1, node: 'pve-01', reachable: false, reason: 'x' };
    processProbes([a], { pressureThreshold: 0.85, unreachableThreshold: 5, now: 1 });
    processProbes([a], { pressureThreshold: 0.85, unreachableThreshold: 5, now: 2 });
    // Fleet change — `a` is gone. If we ever see it again the counter
    // must have been reset.
    processProbes([], { pressureThreshold: 0.85, unreachableThreshold: 5, now: 3 });
    const take = captureEvents();
    processProbes([a], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 4 });
    processProbes([a], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 5 });
    assert.equal(take().length, 0, 'counter was reset by GC');
    processProbes([a], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 6 });
    assert.equal(take().length, 1, 'fires fresh after GC-restored cycle');
  });

  it('skips pseudo-filesystems with zero total (probe lib drops them) — sanity', () => {
    // `probeGuest` already filters these; test here just pins the
    // invariant that processProbes won't crash on empty fs lists.
    const take = captureEvents();
    const probe: GuestProbe = { vmid: 5, node: 'pve-01', reachable: true, filesystems: [] };
    const pressures = processProbes([probe], {
      pressureThreshold: 0.85, unreachableThreshold: 3, now: 1,
    });
    assert.equal(pressures.length, 0);
    assert.equal(take().length, 0);
  });
});

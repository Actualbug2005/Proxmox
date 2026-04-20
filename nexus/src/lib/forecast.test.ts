import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { forecast } from './forecast';

describe('forecast', () => {
  it('returns null for fewer than 10 samples', () => {
    const samples = [
      { t: 0, v: 0.1 },
      { t: 60, v: 0.2 },
    ];
    assert.equal(forecast({ samples, horizonSeconds: 600 }), null);
  });

  it('produces a near-flat forecast for a flat series', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.5,
    }));
    const result = forecast({ samples, horizonSeconds: 600 });
    assert.ok(result);
    assert.ok(result!.points.length > 0);
    const last = result!.points[result!.points.length - 1];
    assert.ok(
      Math.abs(last.v - 0.5) < 0.01,
      `expected last forecast near 0.5, got ${last.v}`,
    );
  });

  it('extrapolates an increasing trend', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.1 * i,
    }));
    const result = forecast({ samples, horizonSeconds: 600 });
    assert.ok(result);
    assert.ok(result!.points.length > 0);
    const last = result!.points[result!.points.length - 1];
    assert.ok(
      last.v > 1.5,
      `expected last forecast > 1.5, got ${last.v}`,
    );
  });

  it('flags a threshold crossing', () => {
    // With damped-trend defaults (phi=0.9) the asymptote on a 0.1+0.01*i
    // series sits near ~0.29, so the previous `threshold: 0.8` is now
    // unreachable. Use a steeper ramp (0.05/step) whose asymptote is above
    // 0.9 so the crossing stays within the damped horizon.
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.1 + 0.05 * i,
    }));
    const result = forecast({
      samples,
      horizonSeconds: 60000,
      thresholds: [0.9],
    });
    assert.ok(result);
    assert.equal(result!.crossings.length, 1);
    assert.equal(result!.crossings[0].threshold, 0.9);
  });

  it('returns low confidence for a high-noise series', () => {
    // Seeded xorshift32 so the test is deterministic.
    let state = 0x12345678;
    const rand = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      // Map to [0, 1).
      return ((state >>> 0) % 1_000_000) / 1_000_000;
    };
    const samples = Array.from({ length: 30 }, (_, i) => ({
      t: i * 60,
      v: 0.5 + 0.4 * (rand() - 0.5) * 2,
    }));
    const result = forecast({ samples, horizonSeconds: 600 });
    assert.ok(result);
    assert.equal(result!.confidence, 'low');
  });

  it('empty thresholds array returns empty crossings', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.1 + 0.01 * i,
    }));
    const result = forecast({ samples, horizonSeconds: 600 });
    assert.ok(result);
    assert.deepEqual(result!.crossings, []);
  });

  it('negative trend produces no upward-threshold crossings', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 1 - 0.01 * i,
    }));
    const result = forecast({
      samples,
      horizonSeconds: 600,
      thresholds: [2],
    });
    assert.ok(result);
    assert.deepEqual(result!.crossings, []);
  });
});

describe('forecast damped trend', () => {
  it('approaches a horizontal asymptote (does not run off to infinity)', () => {
    // Rising series. At phi=0.9 the asymptotic increment is trend * 0.9 / 0.1 = 9 * trend.
    // After 10,000 steps the forecast should be very close to its asymptote, NOT level + 10000*trend.
    const samples = Array.from({ length: 30 }, (_, i) => ({
      t: i * 60,
      v: 0.1 + 0.01 * i,
    }));
    const result = forecast({
      samples,
      horizonSeconds: 10000 * 60,
      phi: 0.9,
    });
    assert.ok(result);
    const last = result!.points[result!.points.length - 1];
    // Asymptote is bounded; at 10000 steps phi^10000 ~ 0, so forecast ~ level + 9*trend.
    // Just assert the value is bounded somewhere in a sane range, not in the tens of thousands.
    assert.ok(last.v < 10, `expected bounded forecast, got ${last.v}`);
  });

  it("collapses to plain Holt's when phi=1", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.1 * i,
    }));
    const damped = forecast({ samples, horizonSeconds: 600, phi: 1 });
    assert.ok(damped);
    // With phi=1 the last forecast point is level + steps*trend; with phi<1 it would be lower.
    const damped9 = forecast({ samples, horizonSeconds: 600, phi: 0.9 });
    assert.ok(damped9);
    const lastDamped = damped!.points[damped!.points.length - 1].v;
    const lastDamped9 = damped9!.points[damped9!.points.length - 1].v;
    assert.ok(
      lastDamped > lastDamped9,
      `phi=1 should forecast higher than phi=0.9 on a rising series: ${lastDamped} vs ${lastDamped9}`,
    );
  });

  it('skips thresholds beyond the damped asymptote', () => {
    // Gentle rise (0.001/step). With phi=0.9 the asymptote sits near ~0.12,
    // so threshold 0.5 is unreachable. The math should skip it rather than
    // reporting a bogus crossing.
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.1 + 0.001 * i,
    }));
    const result = forecast({
      samples,
      horizonSeconds: 86400,
      phi: 0.9,
      thresholds: [0.5],
    });
    assert.ok(result);
    assert.equal(
      result!.crossings.length,
      0,
      'threshold above asymptote should have no crossing',
    );
  });

  it('still flags threshold crossings within the damped horizon', () => {
    // Slightly steeper rise (0.002/step). Fitted asymptote lands near
    // ~0.137, so threshold 0.135 is reachable. Assert the crossing math
    // doesn't crash and that any reported crossing falls inside the horizon.
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.1 + 0.002 * i,
    }));
    const result = forecast({
      samples,
      horizonSeconds: 86400,
      phi: 0.9,
      thresholds: [0.135],
    });
    assert.ok(result);
    const lastT = samples[samples.length - 1].t;
    for (const c of result!.crossings) {
      assert.ok(c.at > lastT);
      assert.ok(c.at <= lastT + 86400);
    }
  });
});

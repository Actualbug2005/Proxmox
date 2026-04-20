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
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 60,
      v: 0.1 + 0.01 * i,
    }));
    const result = forecast({
      samples,
      horizonSeconds: 60000,
      thresholds: [0.8],
    });
    assert.ok(result);
    assert.equal(result!.crossings.length, 1);
    assert.equal(result!.crossings[0].threshold, 0.8);
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

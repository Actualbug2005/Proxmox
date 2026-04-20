import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { ForecastSample } from '@/lib/forecast';

import {
  clampForecastValue,
  extractForecastSamples,
  hasForecastSignal,
  HORIZON_SECONDS,
} from './rrd-chart';

describe('extractForecastSamples', () => {
  it('returns [] for empty input', () => {
    assert.deepEqual(extractForecastSamples([], 'cpu'), []);
  });

  it('drops undefined/null values and keeps numeric samples', () => {
    const out = extractForecastSamples(
      [
        { time: 1, cpu: 0.3 },
        { time: 2, cpu: undefined },
        { time: 3, cpu: 0.45 },
      ],
      'cpu',
    );
    assert.deepEqual(out, [
      { t: 1, v: 0.3 },
      { t: 3, v: 0.45 },
    ]);
  });

  it('reads the memused field when asked', () => {
    const out = extractForecastSamples([{ time: 1, memused: 1e9 }], 'memused');
    assert.deepEqual(out, [{ t: 1, v: 1e9 }]);
  });

  it('preserves zero as a valid sample (zero is legitimate for CPU)', () => {
    const out = extractForecastSamples(
      [
        { time: 1, cpu: 0 },
        { time: 2, cpu: 0.1 },
      ],
      'cpu',
    );
    assert.deepEqual(out, [
      { t: 1, v: 0 },
      { t: 2, v: 0.1 },
    ]);
  });
});

describe('HORIZON_SECONDS', () => {
  it('maps horizons to expected second counts', () => {
    assert.equal(HORIZON_SECONDS.off, 0);
    assert.equal(HORIZON_SECONDS['24h'], 86400);
    assert.equal(HORIZON_SECONDS['7d'], 86400 * 7);
    assert.equal(HORIZON_SECONDS['30d'], 86400 * 30);
  });
});

describe('clampForecastValue', () => {
  it('clamps CPU values to [0, 1]', () => {
    assert.equal(clampForecastValue(-0.5, 'CPU'), 0);
    assert.equal(clampForecastValue(1.99, 'CPU'), 1);
    assert.equal(clampForecastValue(0.7, 'CPU'), 0.7);
  });

  it('clamps Memory values to [0, upperBound]', () => {
    assert.equal(clampForecastValue(-1e9, 'Memory', 2e9), 0);
    assert.equal(clampForecastValue(5e9, 'Memory', 2e9), 2e9);
    assert.equal(clampForecastValue(1.5e9, 'Memory', 2e9), 1.5e9);
  });

  it('passes Memory through when no upper bound set', () => {
    assert.equal(clampForecastValue(1e9, 'Memory'), 1e9);
    assert.equal(clampForecastValue(-100, 'Memory'), 0);
  });
});

describe('hasForecastSignal', () => {
  it('returns false for empty', () => {
    assert.equal(hasForecastSignal([], 'CPU'), false);
  });

  it('returns false for all-zero Memory', () => {
    const samples: ForecastSample[] = [
      { t: 0, v: 0 },
      { t: 60, v: 0 },
      { t: 120, v: 0 },
    ];
    assert.equal(hasForecastSignal(samples, 'Memory'), false);
  });

  it('returns false for a perfectly flat series', () => {
    const samples: ForecastSample[] = [
      { t: 0, v: 0.5 },
      { t: 60, v: 0.5 },
      { t: 120, v: 0.5 },
    ];
    assert.equal(hasForecastSignal(samples, 'CPU'), false);
  });

  it('returns true for a varying CPU series', () => {
    const samples: ForecastSample[] = [
      { t: 0, v: 0.2 },
      { t: 60, v: 0.4 },
      { t: 120, v: 0.3 },
    ];
    assert.equal(hasForecastSignal(samples, 'CPU'), true);
  });
});

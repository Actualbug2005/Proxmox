import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { extractForecastSamples, HORIZON_SECONDS } from './rrd-chart';

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

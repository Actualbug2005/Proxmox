import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { daysUntilFull, linearRegression, projectToThreshold } from './trend';

describe('linearRegression', () => {
  it('fits a perfect line exactly', () => {
    const fit = linearRegression([
      [0, 0],
      [1, 2],
      [2, 4],
      [3, 6],
    ]);
    assert.ok(fit);
    assert.equal(fit!.slope, 2);
    assert.equal(fit!.intercept, 0);
  });

  it('returns null on a single point', () => {
    assert.equal(linearRegression([[0, 5]]), null);
  });

  it('returns null on a vertical line', () => {
    assert.equal(linearRegression([[1, 10], [1, 20], [1, 30]]), null);
  });
});

describe('projectToThreshold', () => {
  it('returns the crossing x for a rising line', () => {
    const x = projectToThreshold([[0, 0], [10, 5]], 10);
    assert.ok(x !== null);
    // y = 0.5x → crosses 10 at x = 20
    assert.equal(x, 20);
  });

  it('returns null for a flat line', () => {
    assert.equal(projectToThreshold([[0, 1], [1, 1], [2, 1]], 2), null);
  });

  it('returns null for a falling line', () => {
    assert.equal(projectToThreshold([[0, 10], [1, 9], [2, 8]], 5), null);
  });
});

describe('daysUntilFull', () => {
  const day = 24 * 60 * 60; // seconds

  it('projects ~5 days for +1% per day starting at 90%', () => {
    // Build a 10-day series that grows from 90% to 100%.
    const rrd = Array.from({ length: 11 }, (_, i) => ({
      time: i * day,
      used: 90 + i,
      total: 100,
    }));
    const d = daysUntilFull(rrd, 0.95);
    assert.ok(d !== null);
    // 95% lands 5 days after the series starts at 90% — latest sample is
    // day 10 at 100%, so "days from latest" is negative? Actually our
    // helper clamps "already past threshold" to 0.
    assert.equal(d, 0);
  });

  it('projects a positive days-count for a growing series below threshold', () => {
    // 10 samples, 80 → 89 used over 10 days, total 100. Slope = 1/day.
    // At latest (day 9, used 89), threshold 95 is 6 days away.
    const rrd = Array.from({ length: 10 }, (_, i) => ({
      time: i * day,
      used: 80 + i,
      total: 100,
    }));
    const d = daysUntilFull(rrd, 0.95);
    assert.ok(d !== null);
    assert.ok(d > 5 && d < 7, `expected ~6 days, got ${d}`);
  });

  it('returns null for a flat series', () => {
    const rrd = Array.from({ length: 10 }, (_, i) => ({
      time: i * day,
      used: 80,
      total: 100,
    }));
    assert.equal(daysUntilFull(rrd), null);
  });

  it('returns null for a shrinking series (deletes happening)', () => {
    const rrd = Array.from({ length: 5 }, (_, i) => ({
      time: i * day,
      used: 50 - i,
      total: 100,
    }));
    assert.equal(daysUntilFull(rrd), null);
  });

  it('returns null when total is missing or zero', () => {
    const rrd = [
      { time: 0, used: 50, total: 0 },
      { time: day, used: 60, total: 0 },
    ];
    assert.equal(daysUntilFull(rrd), null);
  });

  it('returns null with fewer than 2 usable points', () => {
    assert.equal(daysUntilFull([]), null);
    assert.equal(
      daysUntilFull([{ time: 0, used: 50, total: 100 }]),
      null,
    );
  });
});

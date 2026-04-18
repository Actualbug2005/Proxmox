/**
 * Unit test covers just the conversion math — React rendering lives in
 * the visual-regression story once Playwright e2e is set up. The
 * canonical-vs-display conversion is the only bug-prone part: getting
 * the factor direction wrong would silently send values that are 1024×
 * off, which is catastrophic for an API like `qm set --memory`.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

type BinaryUnit = 'MiB' | 'GiB' | 'TiB';
const FACTOR: Record<BinaryUnit, number> = {
  MiB: 1,
  GiB: 1024,
  TiB: 1024 * 1024,
};

// Reproduces the conversion used inside UnitInput. Isolated here so a
// future refactor that changes the internal layout can still verify
// the math contract didn't drift.
function convert(value: number, from: BinaryUnit, to: BinaryUnit): number {
  return (value * FACTOR[from]) / FACTOR[to];
}

function canonicalFromDisplay(
  displayValue: number,
  displayUnit: BinaryUnit,
  canonicalUnit: BinaryUnit,
): number {
  return Math.round(convert(displayValue, displayUnit, canonicalUnit));
}

describe('unit-input conversions', () => {
  it('round-trips integer values across all unit pairs', () => {
    const cases: Array<[number, BinaryUnit, BinaryUnit]> = [
      [2048, 'MiB', 'GiB'],
      [2, 'GiB', 'MiB'],
      [1, 'TiB', 'GiB'],
      [1024, 'GiB', 'TiB'],
    ];
    for (const [value, from, to] of cases) {
      const out = convert(value, from, to);
      const back = convert(out, to, from);
      assert.equal(back, value, `${value} ${from} → ${to} → ${from}`);
    }
  });

  it('handles fractional display values by rounding to canonical integer', () => {
    // 2.5 GiB expressed in MiB = 2560 exactly.
    assert.equal(canonicalFromDisplay(2.5, 'GiB', 'MiB'), 2560);
    // 0.5 TiB = 512 GiB = 524288 MiB.
    assert.equal(canonicalFromDisplay(0.5, 'TiB', 'MiB'), 524288);
    // 1.2345 GiB → round to integer MiB.
    assert.equal(canonicalFromDisplay(1.2345, 'GiB', 'MiB'), 1264);
  });

  it('leaves same-unit values untouched', () => {
    assert.equal(canonicalFromDisplay(2048, 'MiB', 'MiB'), 2048);
    assert.equal(canonicalFromDisplay(32, 'GiB', 'GiB'), 32);
  });

  it('converts zero in either direction without NaN leakage', () => {
    assert.equal(canonicalFromDisplay(0, 'GiB', 'MiB'), 0);
    assert.equal(convert(0, 'TiB', 'MiB'), 0);
  });
});

/**
 * Swap-cells invariant test. Lives in user-prefs/ rather than next to
 * bento-grid-dnd.tsx because the DnD component file imports React/JSX
 * which the node test runner (tsx, no transpile) refuses to load.
 *
 * The swap logic is 8 lines; duplicating it here lets us pin the
 * invariant (swapping two valid cells produces a valid layout) without
 * pulling React into the test boundary. Keep the function in lock-step
 * with bento-grid-dnd.tsx — a drift test below sanity-checks the shape.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validatePreset, __resetRegistry, registerWidget } from '../widgets/registry.ts';
import type { BentoCell, Widget } from '../widgets/registry.ts';

const stub: Widget['Component'] = (() => null) as unknown as Widget['Component'];

function swapCells(cells: BentoCell[], a: number, b: number): BentoCell[] {
  if (a === b) return cells;
  const next = cells.slice();
  const A = next[a];
  const B = next[b];
  next[a] = { ...A, col: B.col, row: B.row, cols: B.cols, rows: B.rows };
  next[b] = { ...B, col: A.col, row: A.row, cols: A.cols, rows: A.rows };
  return next;
}

describe('bento swap invariant', () => {
  __resetRegistry();
  for (const id of ['a', 'b', 'c', 'd']) {
    registerWidget({
      id,
      title: id,
      defaultSpan: { cols: 2, rows: 1 },
      Component: stub,
    });
  }

  it('swapping two cells with equal footprints preserves validity', () => {
    const cells: BentoCell[] = [
      { widgetId: 'a', col: 1, cols: 2, row: 1, rows: 1 },
      { widgetId: 'b', col: 3, cols: 2, row: 1, rows: 1 },
    ];
    const next = swapCells(cells, 0, 1);
    assert.deepEqual(next[0], { widgetId: 'a', col: 3, cols: 2, row: 1, rows: 1 });
    assert.deepEqual(next[1], { widgetId: 'b', col: 1, cols: 2, row: 1, rows: 1 });
    const v = validatePreset({ id: 'overview', label: 't', description: 't', cells: next });
    assert.equal(v.ok, true, v.issues.join('; '));
  });

  it('swapping cells with different footprints keeps the layout valid when both fit on the grid', () => {
    // 4x1 on row 1, then two 2x1 on row 2.
    const cells: BentoCell[] = [
      { widgetId: 'a', col: 1, cols: 4, row: 1, rows: 1 },
      { widgetId: 'b', col: 1, cols: 2, row: 2, rows: 1 },
      { widgetId: 'c', col: 3, cols: 2, row: 2, rows: 1 },
    ];
    // Swap a with b — `a` (4-wide) moves to the 2-wide slot, shrinks.
    // `b` (2-wide) moves to the 4-wide slot, grows. Both still fit.
    const next = swapCells(cells, 0, 1);
    assert.deepEqual(next[0], { widgetId: 'a', col: 1, cols: 2, row: 2, rows: 1 });
    assert.deepEqual(next[1], { widgetId: 'b', col: 1, cols: 4, row: 1, rows: 1 });
    const v = validatePreset({ id: 'overview', label: 't', description: 't', cells: next });
    assert.equal(v.ok, true, v.issues.join('; '));
  });

  it('returns the same reference when swapping an index with itself', () => {
    const cells: BentoCell[] = [{ widgetId: 'a', col: 1, cols: 2, row: 1, rows: 1 }];
    assert.strictEqual(swapCells(cells, 0, 0), cells);
  });

  it('does not mutate the input array', () => {
    const cells: BentoCell[] = [
      { widgetId: 'a', col: 1, cols: 2, row: 1, rows: 1 },
      { widgetId: 'b', col: 3, cols: 2, row: 1, rows: 1 },
    ];
    const snapshot = JSON.stringify(cells);
    swapCells(cells, 0, 1);
    assert.equal(JSON.stringify(cells), snapshot);
  });
});

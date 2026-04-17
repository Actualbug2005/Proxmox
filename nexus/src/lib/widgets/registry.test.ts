import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import {
  __resetRegistry,
  registerWidget,
  validatePreset,
  type BentoPreset,
  type Widget,
} from './registry.ts';

// The widget Component is never invoked by validation, so a trivial
// stub is fine — no need to pull in React for these tests.
const stub: Widget['Component'] = (() => null) as unknown as Widget['Component'];

function makeWidget(id: string): Widget {
  return {
    id,
    title: id,
    defaultSpan: { cols: 2, rows: 1 },
    Component: stub,
  };
}

beforeEach(() => {
  __resetRegistry();
});

describe('widget registry', () => {
  it('validatePreset — accepts a clean preset', () => {
    registerWidget(makeWidget('a'));
    registerWidget(makeWidget('b'));
    const preset: BentoPreset = {
      id: 'overview',
      label: 'x',
      description: 'x',
      cells: [
        { widgetId: 'a', col: 1, cols: 2, row: 1, rows: 1 },
        { widgetId: 'b', col: 3, cols: 2, row: 1, rows: 1 },
      ],
    };
    const v = validatePreset(preset);
    assert.equal(v.ok, true, v.issues.join('; '));
  });

  it('validatePreset — rejects unknown widget id', () => {
    const preset: BentoPreset = {
      id: 'noc',
      label: 'x',
      description: 'x',
      cells: [{ widgetId: 'ghost', col: 1, cols: 1, row: 1, rows: 1 }],
    };
    const v = validatePreset(preset);
    assert.equal(v.ok, false);
    assert.ok(v.issues.some((msg) => msg.includes('ghost')));
  });

  it('validatePreset — rejects overflow beyond 4-col grid', () => {
    registerWidget(makeWidget('wide'));
    const preset: BentoPreset = {
      id: 'capacity',
      label: 'x',
      description: 'x',
      cells: [{ widgetId: 'wide', col: 3, cols: 3, row: 1, rows: 1 }],
    };
    const v = validatePreset(preset);
    assert.equal(v.ok, false);
    assert.ok(v.issues.some((msg) => msg.includes('overflows')));
  });

  it('validatePreset — rejects overlapping cells', () => {
    registerWidget(makeWidget('a'));
    registerWidget(makeWidget('b'));
    const preset: BentoPreset = {
      id: 'incidents',
      label: 'x',
      description: 'x',
      cells: [
        { widgetId: 'a', col: 1, cols: 2, row: 1, rows: 1 },
        // b overlaps a at col=2,row=1.
        { widgetId: 'b', col: 2, cols: 2, row: 1, rows: 1 },
      ],
    };
    const v = validatePreset(preset);
    assert.equal(v.ok, false);
    assert.ok(v.issues.some((msg) => msg.includes('overlaps')));
  });

  it('validatePreset — empty preset is vacuously ok', () => {
    const preset: BentoPreset = {
      id: 'overview',
      label: 'x',
      description: 'x',
      cells: [],
    };
    assert.equal(validatePreset(preset).ok, true);
  });
});

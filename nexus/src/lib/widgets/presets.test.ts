import { strict as assert } from 'node:assert';
import { describe, it, before } from 'node:test';
import { PRESETS, PRESET_IDS } from './presets.ts';
import {
  __resetRegistry,
  registerWidget,
  validatePreset,
  type Widget,
} from './registry.ts';

// Hard-coded widget id set that register-all.ts provides. Keeping the
// list duplicated here — rather than importing the real register-all —
// lets this test run under `node --import tsx --test` without pulling
// in React component modules. If register-all grows a widget the test
// will catch the drift because a preset referencing the new id would
// land in PRESETS before this fixture is updated, and validatePreset()
// would report an unknown id.
const EXPECTED_WIDGET_IDS = [
  'cluster-summary',
  'node-roster',
  'recent-tasks',
  'pressure-summary',
  'storage-exhaustion',
  'top-offenders',
  'recent-failures',
  'guest-trouble',
  'guest-disk-pressure',
] as const;

const stubComponent: Widget['Component'] = (() => null) as unknown as Widget['Component'];

before(() => {
  __resetRegistry();
  for (const id of EXPECTED_WIDGET_IDS) {
    registerWidget({
      id,
      title: id,
      defaultSpan: { cols: 2, rows: 1 },
      Component: stubComponent,
    });
  }
});

describe('bento presets', () => {
  it('all four preset ids are defined', () => {
    assert.deepEqual(
      [...PRESET_IDS].sort(),
      ['capacity', 'incidents', 'noc', 'overview'],
    );
  });

  for (const id of PRESET_IDS) {
    it(`preset "${id}" has no unknown widgets, overflow, or overlaps`, () => {
      const preset = PRESETS[id];
      const v = validatePreset(preset);
      assert.equal(v.ok, true, `${id}: ${v.issues.join('; ')}`);
      assert.ok(preset.cells.length > 0, `${id}: preset must not be empty`);
      assert.equal(preset.label.length > 0, true);
      assert.equal(preset.description.length > 0, true);
    });
  }
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAriaLabel } from './alert-bell';

describe('buildAriaLabel', () => {
  it('returns "Add alert rule" when count is 0', () => {
    assert.equal(buildAriaLabel(0), 'Add alert rule');
  });

  it('returns "1 alert rule" (singular) when count is 1', () => {
    assert.equal(buildAriaLabel(1), '1 alert rule');
  });

  it('returns "N alert rules" (plural) for N ≥ 2', () => {
    assert.equal(buildAriaLabel(2), '2 alert rules');
    assert.equal(buildAriaLabel(5), '5 alert rules');
    assert.equal(buildAriaLabel(999), '999 alert rules');
  });
});

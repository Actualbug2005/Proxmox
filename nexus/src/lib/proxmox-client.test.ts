import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  toPveBool,
  fromPveBool,
  encodeBoolFields,
  decodeBoolFields,
} from './proxmox-client';

describe('toPveBool', () => {
  it('encodes true → 1 and false → 0', () => {
    assert.equal(toPveBool(true), 1);
    assert.equal(toPveBool(false), 0);
  });

  it('passes undefined through', () => {
    assert.equal(toPveBool(undefined), undefined);
  });
});

describe('fromPveBool', () => {
  it('decodes 1 → true and 0 → false', () => {
    assert.equal(fromPveBool(1), true);
    assert.equal(fromPveBool(0), false);
  });

  it('coerces null and undefined to false (Proxmox omits absent flags)', () => {
    assert.equal(fromPveBool(null), false);
    assert.equal(fromPveBool(undefined), false);
  });

  it('accepts already-decoded booleans (idempotent)', () => {
    assert.equal(fromPveBool(true), true);
    assert.equal(fromPveBool(false), false);
  });
});

describe('encode/decode round-trip', () => {
  it('encode ∘ decode is identity on boolean inputs', () => {
    for (const v of [true, false]) {
      assert.equal(fromPveBool(toPveBool(v)), v);
    }
  });
});

describe('encodeBoolFields', () => {
  it('flips listed boolean keys to 0/1 and leaves others intact', () => {
    const input = { enable: true, force: false, name: 'ct-01', vmid: 101 };
    const out = encodeBoolFields(input, ['enable', 'force'] as const);
    assert.deepEqual(out, { enable: 1, force: 0, name: 'ct-01', vmid: 101 });
  });

  it('preserves undefined on listed keys (omits rather than sends 0)', () => {
    const input: { enable?: boolean; force?: boolean } = { enable: true };
    const out = encodeBoolFields(input, ['enable', 'force'] as const);
    assert.equal(out.enable, 1);
    assert.equal(out.force, undefined);
  });

  it('does not mutate the input object', () => {
    const input = { enable: true };
    encodeBoolFields(input, ['enable'] as const);
    assert.equal(input.enable, true);
  });

  it('tolerates an empty keys list', () => {
    const input = { enable: true, vmid: 42 };
    const out = encodeBoolFields(input, [] as const);
    assert.deepEqual(out, input);
    assert.notEqual(out, input); // still a copy
  });
});

describe('decodeBoolFields', () => {
  it('flips listed 0/1 keys to booleans and leaves others intact', () => {
    const input = { enabled: 1 as const, running: 0 as const, name: 'node1' };
    const out = decodeBoolFields(input, ['enabled', 'running'] as const);
    assert.deepEqual(out, { enabled: true, running: false, name: 'node1' });
  });

  it('preserves undefined on listed keys', () => {
    const input: { enabled?: 0 | 1 } = {};
    const out = decodeBoolFields(input, ['enabled'] as const);
    assert.equal(out.enabled, undefined);
  });

  it('does not mutate the input object', () => {
    const input = { enabled: 1 as const };
    decodeBoolFields(input, ['enabled'] as const);
    assert.equal(input.enabled, 1);
  });
});

describe('encodeBoolFields ∘ decodeBoolFields round-trip', () => {
  it('round-trips across a realistic params object', () => {
    const original = { enable: true, force: false, autostart: true, name: 'job-1' };
    const wire = encodeBoolFields(original, ['enable', 'force', 'autostart'] as const);
    const back = decodeBoolFields(wire, ['enable', 'force', 'autostart'] as const);
    assert.deepEqual(back, original);
  });
});

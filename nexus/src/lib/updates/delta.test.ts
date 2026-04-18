/**
 * Delta classifier + auto-install scope gate. Pure logic, no I/O.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { autoInstallAllowed, classifyDelta, parseSemver } from './delta.ts';

describe('parseSemver', () => {
  it('accepts leading v and plain SemVer', () => {
    assert.deepEqual(parseSemver('v1.2.3'), { major: 1, minor: 2, patch: 3 });
    assert.deepEqual(parseSemver('0.22.0'), { major: 0, minor: 22, patch: 0 });
  });
  it('strips pre-release suffixes', () => {
    assert.deepEqual(parseSemver('v0.22.0-rc.1'), { major: 0, minor: 22, patch: 0 });
  });
  it('rejects non-SemVer', () => {
    assert.equal(parseSemver(''), null);
    assert.equal(parseSemver('main'), null);
    assert.equal(parseSemver('v1'), null);
    assert.equal(parseSemver('v1.2'), null);
    assert.equal(parseSemver('garbage'), null);
  });
});

describe('classifyDelta', () => {
  it('detects patch / minor / major forward steps', () => {
    assert.equal(classifyDelta('v1.2.3', 'v1.2.4'), 'patch');
    assert.equal(classifyDelta('v1.2.3', 'v1.3.0'), 'minor');
    assert.equal(classifyDelta('v1.2.3', 'v2.0.0'), 'major');
  });
  it('detects same and older', () => {
    assert.equal(classifyDelta('v1.2.3', 'v1.2.3'), 'same');
    assert.equal(classifyDelta('v1.2.3', 'v1.2.2'), 'older');
    assert.equal(classifyDelta('v1.2.3', 'v1.1.9'), 'older');
    assert.equal(classifyDelta('v2.0.0', 'v1.9.9'), 'older');
  });
  it('returns null when either tag is unparseable', () => {
    assert.equal(classifyDelta('dev', 'v1.2.3'), null);
    assert.equal(classifyDelta('v1.2.3', 'main'), null);
  });
});

describe('autoInstallAllowed', () => {
  it('patch scope permits only patches', () => {
    assert.equal(autoInstallAllowed('patch', 'patch'), true);
    assert.equal(autoInstallAllowed('minor', 'patch'), false);
    assert.equal(autoInstallAllowed('major', 'patch'), false);
  });
  it('minor scope permits patch + minor', () => {
    assert.equal(autoInstallAllowed('patch', 'minor'), true);
    assert.equal(autoInstallAllowed('minor', 'minor'), true);
    assert.equal(autoInstallAllowed('major', 'minor'), false);
  });
  it('any scope permits every forward delta', () => {
    assert.equal(autoInstallAllowed('patch', 'any'), true);
    assert.equal(autoInstallAllowed('minor', 'any'), true);
    assert.equal(autoInstallAllowed('major', 'any'), true);
  });
  it('older and same never qualify at any scope', () => {
    for (const scope of ['patch', 'minor', 'any'] as const) {
      assert.equal(autoInstallAllowed('older', scope), false, `older @ ${scope}`);
      assert.equal(autoInstallAllowed('same', scope), false, `same @ ${scope}`);
    }
  });
});

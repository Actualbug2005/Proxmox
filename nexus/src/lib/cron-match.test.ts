import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchesCron, parseCron, validateCron } from './cron-match';

const d = (y: number, mo: number, da: number, h: number, mi: number) =>
  // Month is 1-indexed in the helper; JS Date wants 0-indexed.
  new Date(y, mo - 1, da, h, mi, 0, 0);

test('literal match in all fields', () => {
  assert.equal(matchesCron('30 14 15 6 *', d(2026, 6, 15, 14, 30)), true);
});

test('wildcard matches any time', () => {
  assert.equal(matchesCron('* * * * *', d(2026, 1, 1, 0, 0)), true);
  assert.equal(matchesCron('* * * * *', d(2030, 12, 31, 23, 59)), true);
});

test('minute step */5', () => {
  assert.equal(matchesCron('*/5 * * * *', d(2026, 4, 17, 10, 0)), true);
  assert.equal(matchesCron('*/5 * * * *', d(2026, 4, 17, 10, 5)), true);
  assert.equal(matchesCron('*/5 * * * *', d(2026, 4, 17, 10, 3)), false);
});

test('comma list of hours', () => {
  assert.equal(matchesCron('0 2,14 * * *', d(2026, 4, 17, 2, 0)), true);
  assert.equal(matchesCron('0 2,14 * * *', d(2026, 4, 17, 14, 0)), true);
  assert.equal(matchesCron('0 2,14 * * *', d(2026, 4, 17, 6, 0)), false);
});

test('hyphen range', () => {
  assert.equal(matchesCron('0 9-17 * * *', d(2026, 4, 17, 9, 0)), true);
  assert.equal(matchesCron('0 9-17 * * *', d(2026, 4, 17, 17, 0)), true);
  assert.equal(matchesCron('0 9-17 * * *', d(2026, 4, 17, 8, 0)), false);
  assert.equal(matchesCron('0 9-17 * * *', d(2026, 4, 17, 18, 0)), false);
});

test('pve-extended .. range', () => {
  // mon..fri = weekdays. 2026-04-17 is a Friday (dow=5).
  assert.equal(matchesCron('0 2 * * mon..fri', d(2026, 4, 17, 2, 0)), true);
  // 2026-04-18 is Saturday.
  assert.equal(matchesCron('0 2 * * mon..fri', d(2026, 4, 18, 2, 0)), false);
});

test('day-of-week names and 7 alias for sunday', () => {
  // 2026-04-19 is a Sunday (dow=0).
  assert.equal(matchesCron('0 2 * * sun', d(2026, 4, 19, 2, 0)), true);
  assert.equal(matchesCron('0 2 * * 7',   d(2026, 4, 19, 2, 0)), true);
  assert.equal(matchesCron('0 2 * * 0',   d(2026, 4, 19, 2, 0)), true);
});

test('vixie or-semantics: dom OR dow when both restricted', () => {
  // Fire on the 1st OR Mondays. 2026-04-17 is Fri; dom=17, not Mon. No match.
  assert.equal(matchesCron('0 0 1 * mon', d(2026, 4, 17, 0, 0)), false);
  // 2026-04-20 is Mon, dom=20 — should match via dow.
  assert.equal(matchesCron('0 0 1 * mon', d(2026, 4, 20, 0, 0)), true);
  // 2026-04-01 is Wed, dom=1 — should match via dom.
  assert.equal(matchesCron('0 0 1 * mon', d(2026, 4, 1, 0, 0)), true);
});

test('month name', () => {
  assert.equal(matchesCron('0 0 1 apr *', d(2026, 4, 1, 0, 0)), true);
  assert.equal(matchesCron('0 0 1 apr *', d(2026, 5, 1, 0, 0)), false);
});

test('range with step 1-30/10', () => {
  const values = parseCron('1-30/10 * * * *').minute;
  assert.deepEqual([...values].sort((a, b) => a - b), [1, 11, 21]);
});

test('parse rejects out-of-range minute', () => {
  assert.throws(() => validateCron('60 * * * *'), /Out of range/);
});

test('parse rejects wrong field count', () => {
  assert.throws(() => validateCron('* * * *'), /Expected 5 cron fields/);
});

test('parse rejects non-numeric token', () => {
  assert.throws(() => validateCron('abc * * * *'), /Invalid cron token/);
});

test('parse rejects zero step', () => {
  assert.throws(() => validateCron('*/0 * * * *'), /Invalid step/);
});

test('parse rejects inverted range', () => {
  assert.throws(() => validateCron('30-10 * * * *'), /Invalid range/);
});

test('raw matcher returns false on garbage input instead of throwing', () => {
  assert.equal(matchesCron('not a cron', new Date()), false);
});

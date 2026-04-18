/**
 * Filter + newest-first parser for the Audit Log Explorer backend.
 *
 * The route reads exec.jsonl as a blob and hands it to `selectEntries`,
 * so these cases pin the parse/filter behaviour without touching I/O.
 * They matter because the route short-circuits the walk once `limit`
 * matches have accumulated — an off-by-one here would either miss
 * matches or return duplicates.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { matches, selectEntries, type EntryFilter } from './filter.ts';
import type { SafeEntry } from '../../../../lib/exec-audit.ts';

function entry(
  id: string,
  user: string,
  endpoint: SafeEntry['endpoint'],
  node: string,
  ts: string,
  exitCode: number | null = 0,
): SafeEntry {
  return {
    id,
    ts,
    user,
    node,
    endpoint,
    cmd_sha256: 'x'.repeat(64),
    cmd_len: 42,
    exitCode,
    durationMs: 100,
  };
}

function jsonl(entries: SafeEntry[]): string {
  // Include a trailing newline AND a torn empty line — mirrors what
  // journald / a log-rotator can leave behind between appends.
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n\n';
}

describe('matches', () => {
  const e = entry('id-1', 'root@pam', 'exec', 'pve', '2026-04-18T07:00:00.000Z');

  it('accepts when no filter is set', () => {
    assert.equal(matches(e, {}), true);
  });
  it('filters by user', () => {
    assert.equal(matches(e, { user: 'root@pam' }), true);
    assert.equal(matches(e, { user: 'someone@pve' }), false);
  });
  it('filters by endpoint', () => {
    assert.equal(matches(e, { endpoint: 'exec' }), true);
    assert.equal(matches(e, { endpoint: 'scripts.run' }), false);
  });
  it('filters by node', () => {
    assert.equal(matches(e, { node: 'pve' }), true);
    assert.equal(matches(e, { node: 'pve2' }), false);
  });
  it('filters by since / until (ms windows)', () => {
    const t = Date.parse(e.ts);
    assert.equal(matches(e, { sinceMs: t - 1 }), true);
    assert.equal(matches(e, { sinceMs: t + 1 }), false);
    assert.equal(matches(e, { untilMs: t + 1 }), true);
    assert.equal(matches(e, { untilMs: t - 1 }), false);
  });
  it('is conjunctive — all criteria must pass', () => {
    const f: EntryFilter = { user: 'root@pam', endpoint: 'scripts.run' };
    assert.equal(matches(e, f), false, 'endpoint mismatch fails even when user matches');
  });
});

describe('selectEntries', () => {
  const a = entry('a', 'root@pam', 'exec',        'pve',  '2026-04-18T07:00:00.000Z');
  const b = entry('b', 'ops@pam',  'scripts.run', 'pve',  '2026-04-18T07:01:00.000Z');
  const c = entry('c', 'root@pam', 'exec',        'pve2', '2026-04-18T07:02:00.000Z');
  const body = jsonl([a, b, c]);

  it('returns matches newest-first regardless of file order', () => {
    const { entries, total } = selectEntries(body, {}, 10);
    assert.equal(total, 3);
    assert.deepEqual(entries.map((e) => e.id), ['c', 'b', 'a']);
  });

  it('caps the returned list at `limit` but still counts full total', () => {
    const { entries, total } = selectEntries(body, {}, 2);
    assert.equal(entries.length, 2);
    assert.equal(total, 3, 'total must reflect unreturned matches for the truncation UI');
    assert.deepEqual(entries.map((e) => e.id), ['c', 'b']);
  });

  it('skips blank lines and torn writes rather than throwing', () => {
    const torn = body + '{"id":"broken","ts":\n';
    const { entries, total } = selectEntries(torn, {}, 10);
    assert.equal(total, 3, 'the garbage line is dropped, not counted');
    assert.deepEqual(entries.map((e) => e.id), ['c', 'b', 'a']);
  });

  it('applies the filter before counting', () => {
    const { entries, total } = selectEntries(body, { user: 'root@pam' }, 10);
    assert.equal(total, 2);
    assert.deepEqual(entries.map((e) => e.id), ['c', 'a']);
  });
});

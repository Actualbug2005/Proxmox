/**
 * Tests for shell-execution primitives.
 *
 * NODE_RE is the load-bearing input filter: it rejects any value that could
 * become an ssh flag injection (e.g. `-oProxyCommand=…`), control char,
 * empty string, or anything outside [A-Za-z0-9.-_]. A regression here is
 * a remote-code-execution vector.
 *
 * runViaStdin tests cover the kill-on-timeout, kill-on-overflow, and
 * happy-path stdout capture. They spawn a real subprocess (cat / sleep)
 * so they exercise the actual spawn → stdin → stdout → close pipeline.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { NODE_RE, runViaStdin } from './remote-shell.ts';

describe('NODE_RE', () => {
  const accepts: string[] = [
    'pve',
    'pve-1',
    'pve_2',
    'pve.example.com',
    'NODE-9',
    'a',
    // 63 chars (boundary; the regex caps at 1 + 62 = 63)
    'a' + '0'.repeat(62),
  ];
  for (const s of accepts) {
    it(`accepts ${JSON.stringify(s)}`, () => {
      assert.equal(NODE_RE.test(s), true);
    });
  }

  const rejects: string[] = [
    '',
    '.pve', // can't start with a non-alnum
    '-pve', // ssh flag injection — must not match
    '-oProxyCommand=anything',
    'pve;rm -rf',
    'pve nodename',
    'pve\nnewline',
    'pve\t',
    'pve\\backslash',
    'pve/slash',
    'pve@host', // userid-like
    'pve:colon',
    'a' + '0'.repeat(63), // 64 chars total — over the 63 limit
  ];
  for (const s of rejects) {
    it(`rejects ${JSON.stringify(s)}`, () => {
      assert.equal(NODE_RE.test(s), false);
    });
  }
});

describe('runViaStdin', () => {
  it('captures stdout from a successful command', async () => {
    const result = await runViaStdin('cat', [], 'hello world');
    assert.equal(result.stdout, 'hello world');
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
  });

  it('captures non-zero exit codes', async () => {
    // bash -s reads the script from stdin; `exit 7` produces exit code 7.
    const result = await runViaStdin('bash', ['-s'], 'exit 7');
    assert.equal(result.exitCode, 7);
  });

  it('rejects with a timeout error when the command outlives timeoutMs', async () => {
    await assert.rejects(
      runViaStdin('bash', ['-s'], 'sleep 5', { timeoutMs: 100 }),
      /timed out/,
    );
  });

  it('rejects when stdout exceeds maxBuffer', async () => {
    // yes prints "y\n" forever; the maxBuffer cap kills it almost immediately.
    await assert.rejects(
      runViaStdin('yes', [], '', { maxBuffer: 1024, timeoutMs: 5_000 }),
      /maxBuffer/,
    );
  });

  it('rejects on spawn error (no such binary)', async () => {
    await assert.rejects(
      runViaStdin('this-binary-definitely-does-not-exist-9876', [], ''),
    );
  });
});

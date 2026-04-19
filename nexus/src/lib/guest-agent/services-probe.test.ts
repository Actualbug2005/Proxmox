import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFailedUnits } from './services-probe.ts';

describe('parseFailedUnits', () => {
  it('returns [] for empty input', () => {
    assert.deepEqual(parseFailedUnits(''), []);
  });

  it('returns [] for the "0 loaded units listed" informational message', () => {
    // systemctl prints this when nothing matches --state=failed.
    assert.deepEqual(parseFailedUnits('0 loaded units listed.'), []);
  });

  it('parses a single failed unit', () => {
    const raw = 'nginx.service loaded failed failed A high performance web server';
    assert.deepEqual(parseFailedUnits(raw), [
      { unit: 'nginx.service', description: 'A high performance web server' },
    ]);
  });

  it('parses multiple failed units', () => {
    const raw = [
      'nginx.service loaded failed failed A high performance web server',
      'postgresql.service loaded failed failed PostgreSQL RDBMS',
    ].join('\n');
    assert.deepEqual(parseFailedUnits(raw), [
      { unit: 'nginx.service', description: 'A high performance web server' },
      { unit: 'postgresql.service', description: 'PostgreSQL RDBMS' },
    ]);
  });

  it('tolerates trailing whitespace and blank lines', () => {
    const raw = '\n  nginx.service loaded failed failed Nginx   \n\n';
    assert.deepEqual(parseFailedUnits(raw), [
      { unit: 'nginx.service', description: 'Nginx' },
    ]);
  });

  it('skips malformed lines (too few columns)', () => {
    const raw = 'nginx.service loaded';
    assert.deepEqual(parseFailedUnits(raw), []);
  });

  it('preserves description words joined with single spaces', () => {
    // Multiple internal spaces in the description should collapse to one.
    const raw = 'ssh.service loaded failed failed OpenBSD  Secure  Shell  server';
    assert.deepEqual(parseFailedUnits(raw), [
      { unit: 'ssh.service', description: 'OpenBSD Secure Shell server' },
    ]);
  });

  it('rejects tokens without a unit-type suffix', () => {
    // systemd unit names always carry a type (.service, .socket, .target, etc.)
    const raw = 'no-extension loaded failed failed Something';
    assert.deepEqual(parseFailedUnits(raw), []);
  });

  it('strips the systemd status bullet prefix (● / ○ / *)', () => {
    const raw = '● nginx.service loaded failed failed Nginx';
    assert.deepEqual(parseFailedUnits(raw), [
      { unit: 'nginx.service', description: 'Nginx' },
    ]);
  });

  it('strips the bullet on a multi-line payload with mixed prefixes', () => {
    const raw = [
      '● nginx.service loaded failed failed Nginx',
      'postgresql.service loaded failed failed PostgreSQL RDBMS',
      '* redis.service loaded failed failed Redis in-memory store',
    ].join('\n');
    assert.deepEqual(parseFailedUnits(raw), [
      { unit: 'nginx.service', description: 'Nginx' },
      { unit: 'postgresql.service', description: 'PostgreSQL RDBMS' },
      { unit: 'redis.service', description: 'Redis in-memory store' },
    ]);
  });
});

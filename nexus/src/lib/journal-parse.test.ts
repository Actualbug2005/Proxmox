import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseJournalLine } from './journal-parse';

describe('parseJournalLine', () => {
  it('parses a typical pveproxy line', () => {
    const p = parseJournalLine('Apr 14 23:06:22 pve pveproxy[12345]: TLS handshake with 10.0.0.5 failed');
    assert.equal(p.time, 'Apr 14 23:06:22');
    assert.equal(p.host, 'pve');
    assert.equal(p.unit, 'pveproxy');
    assert.match(p.message, /TLS handshake/);
    assert.equal(p.priority, 'info');
  });

  it('detects error priority from keyword', () => {
    const p = parseJournalLine('Apr 14 23:06:22 pve qm[123]: fatal: VM disk missing');
    assert.equal(p.priority, 'error');
  });

  it('detects warning priority', () => {
    const p = parseJournalLine('Apr 14 23:06:22 pve pvedaemon: warning: slow fsync detected');
    assert.equal(p.priority, 'warning');
  });

  it('detects kernel priority from <N> prefix', () => {
    const p = parseJournalLine('Apr 14 23:06:22 pve kernel: <2>CPU halted');
    assert.equal(p.priority, 'error');
  });

  it('strips [pid] from unit', () => {
    const p = parseJournalLine('Apr 14 23:06:22 pve systemd[1]: Started something.service');
    assert.equal(p.unit, 'systemd');
  });

  it('falls back cleanly when the line shape is unknown', () => {
    const p = parseJournalLine('just some text with no header');
    assert.equal(p.time, '');
    assert.equal(p.unit, '');
    assert.equal(p.message, 'just some text with no header');
  });
});

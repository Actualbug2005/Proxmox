/**
 * Tests for the small pure helpers inside the native NAS provider.
 *
 * The script-emitting / shell-executing methods aren't covered here —
 * they're tested via manual smoke against a homelab. This file pins
 * the two corners where a parser bug would silently serve bad data
 * to the quota editor or the extractor used across every provider
 * method.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseRepquotaCsv } from './native.ts';

describe('parseRepquotaCsv', () => {
  it('converts KiB columns to bytes and skips header', () => {
    const csv = [
      'name,type,BlockStatus,FileStatus,BlockUsed,BlockSoft,BlockHard,BlockGrace,FileUsed,FileSoft,FileHard,FileGrace',
      'root,user,ok,ok,2048,4096,8192,0,100,0,0,0',
      'apache,user,ok,ok,1024,0,0,0,50,0,0,0',
    ].join('\n');
    const out = parseRepquotaCsv(csv, 'user');
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      kind: 'user',
      name: 'root',
      usedBytes: 2048 * 1024,
      softBytes: 4096 * 1024,
      hardBytes: 8192 * 1024,
    });
    assert.equal(out[1].name, 'apache');
    assert.equal(out[1].softBytes, 0); // 0 -> no limit
  });

  it('skips comment/banner lines and returns [] on pure garbage', () => {
    const csv = [
      '# *** Report for user quotas on device /dev/sda1',
      '# Block grace time: 7days; Inode grace time: 7days',
      'name,type,...',
    ].join('\n');
    assert.deepEqual(parseRepquotaCsv(csv, 'user'), []);
    assert.deepEqual(parseRepquotaCsv('', 'user'), []);
  });

  it('tags the entries with the requested kind', () => {
    const csv = 'name,t,s,f,BlockUsed,BlockSoft,BlockHard\nadmins,group,ok,ok,0,0,0';
    const out = parseRepquotaCsv(csv, 'group');
    assert.equal(out[0].kind, 'group');
  });
});

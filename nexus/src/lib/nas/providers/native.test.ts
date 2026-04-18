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
import { parseClientMounts, parseRepquotaCsv, parseServiceStatus } from './native.ts';

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

describe('parseServiceStatus', () => {
  it('reads the smb_/nfs_ key=value block and resolves "active" to running', () => {
    const block = [
      'smb_unit=smbd.service',
      'smb_status=active',
      'nfs_unit=',
      'nfs_status=not-installed',
    ].join('\n');
    const out = parseServiceStatus(block);
    assert.deepEqual(out.smb, { status: 'running', unit: 'smbd.service' });
    assert.deepEqual(out.nfs, { status: 'not-installed', unit: '' });
  });

  it('treats anything not "active"/"not-installed" as stopped', () => {
    const block = ['smb_unit=smbd.socket', 'smb_status=inactive'].join('\n');
    const out = parseServiceStatus(block);
    assert.equal(out.smb.status, 'stopped');
    assert.equal(out.smb.unit, 'smbd.socket');
  });

  it('defaults missing prefixes to not-installed', () => {
    const out = parseServiceStatus('');
    assert.equal(out.smb.status, 'not-installed');
    assert.equal(out.nfs.status, 'not-installed');
  });
});

describe('parseClientMounts', () => {
  it('parses CIFS rows with //server/share form', () => {
    const json = JSON.stringify({
      filesystems: [
        {
          source: '//10.2.1.122/The_Singularity',
          target: '/mnt/the_singularity',
          fstype: 'cifs',
          options: 'rw,relatime,vers=3.0',
        },
      ],
    });
    const out = parseClientMounts(json);
    assert.equal(out.length, 1);
    assert.equal(out[0].fsType, 'cifs');
    assert.equal(out[0].server, '10.2.1.122');
    assert.equal(out[0].shareName, 'The_Singularity');
    assert.equal(out[0].readOnly, false);
  });

  it('parses NFS rows with server:/path form and read-only flag', () => {
    const json = JSON.stringify({
      filesystems: [
        {
          source: 'nas01.lan:/exports/data',
          target: '/mnt/data',
          fstype: 'nfs4',
          options: 'ro,relatime',
        },
      ],
    });
    const out = parseClientMounts(json);
    assert.equal(out[0].fsType, 'nfs4');
    assert.equal(out[0].server, 'nas01.lan');
    assert.equal(out[0].shareName, '/exports/data');
    assert.equal(out[0].readOnly, true);
  });

  it('returns empty for empty / non-JSON input', () => {
    assert.deepEqual(parseClientMounts(''), []);
    assert.deepEqual(parseClientMounts('not json'), []);
  });

  it('skips non-network filesystems even if findmnt slipped one in', () => {
    const json = JSON.stringify({
      filesystems: [
        { source: 'tmpfs', target: '/run', fstype: 'tmpfs', options: 'rw' },
      ],
    });
    assert.deepEqual(parseClientMounts(json), []);
  });
});

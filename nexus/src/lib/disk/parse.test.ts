import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVolume, formatVolumeSize, type VolumeDescriptor } from './parse.ts';

describe('parseVolume — VM disks', () => {
  it('parses a minimal scsi disk', () => {
    const result = parseVolume('scsi0', 'local-lvm:vm-100-disk-0,size=32G');
    assert.deepEqual(result, {
      kind: 'vm-disk',
      slot: 'scsi0',
      bus: 'scsi',
      storage: 'local-lvm',
      volume: 'vm-100-disk-0',
      sizeMiB: 32 * 1024,
      raw: 'local-lvm:vm-100-disk-0,size=32G',
    } satisfies VolumeDescriptor);
  });

  it('ignores unknown extras but preserves raw', () => {
    const result = parseVolume('virtio0', 'local-lvm:vm-100-disk-1,size=100G,iothread=1,ssd=1');
    assert.ok(result && result.kind === 'vm-disk');
    assert.equal(result.slot, 'virtio0');
    assert.equal(result.bus, 'virtio');
    assert.equal(result.sizeMiB, 100 * 1024);
    assert.equal(result.raw, 'local-lvm:vm-100-disk-1,size=100G,iothread=1,ssd=1');
  });

  it('recognises all four VM buses', () => {
    for (const bus of ['scsi', 'virtio', 'sata', 'ide'] as const) {
      const r = parseVolume(`${bus}0`, `local-lvm:vm-100-disk-0,size=8G`);
      assert.ok(r && r.kind === 'vm-disk', `expected vm-disk for ${bus}0`);
      assert.equal(r.bus, bus);
    }
  });
});

describe('parseVolume — CT volumes', () => {
  it('parses rootfs', () => {
    const result = parseVolume('rootfs', 'local-lvm:subvol-100-disk-0,size=8G');
    assert.deepEqual(result, {
      kind: 'ct-rootfs',
      storage: 'local-lvm',
      volume: 'subvol-100-disk-0',
      sizeMiB: 8 * 1024,
      raw: 'local-lvm:subvol-100-disk-0,size=8G',
    } satisfies VolumeDescriptor);
  });

  it('parses a mountpoint with mp= path', () => {
    const result = parseVolume('mp0', 'local-lvm:subvol-100-disk-1,size=32G,mp=/data');
    assert.ok(result && result.kind === 'ct-mp');
    assert.equal(result.slot, 'mp0');
    assert.equal(result.mountpoint, '/data');
    assert.equal(result.sizeMiB, 32 * 1024);
  });
});

describe('parseVolume — size-unit round trip', () => {
  it('handles T, G, and M suffixes identically when the value is the same size', () => {
    const a = parseVolume('scsi0', 'local-lvm:v,size=1T');
    const b = parseVolume('scsi0', 'local-lvm:v,size=1024G');
    const c = parseVolume('scsi0', 'local-lvm:v,size=1048576M');
    assert.ok(a && b && c);
    assert.equal(a.sizeMiB, 1024 * 1024);
    assert.equal(a.sizeMiB, b.sizeMiB);
    assert.equal(a.sizeMiB, c.sizeMiB);
  });
});

describe('parseVolume — malformed input returns null, never throws', () => {
  const cases: Array<[string, string]> = [
    ['scsi0', 'local-lvm:vm-100-disk-0'],
    ['scsi0', ''],
    ['hamster0', 'local-lvm:v,size=8G'],
    ['scsi0', 'size=8G'],
    ['scsi0', 'local-lvm:v,size=notanumber'],
    ['mp0', 'local-lvm:v,size=8G'],
  ];
  for (const [key, value] of cases) {
    it(`returns null for ${key}=${value || '(empty)'}`, () => {
      assert.equal(parseVolume(key, value), null);
    });
  }
});

describe('formatVolumeSize', () => {
  it('formats whole-GiB values as GiB', () => {
    assert.equal(formatVolumeSize(32 * 1024), '32 GiB');
  });
  it('formats whole-TiB values as TiB', () => {
    assert.equal(formatVolumeSize(1024 * 1024), '1 TiB');
  });
  it('formats sub-GiB values as MiB', () => {
    assert.equal(formatVolumeSize(512), '512 MiB');
  });
  it('trims fractional trailing zeros on GiB', () => {
    assert.equal(formatVolumeSize(1536), '1.5 GiB');
  });
});

export type VolumeDescriptor =
  | { kind: 'vm-disk'; slot: string; bus: 'scsi' | 'virtio' | 'sata' | 'ide'; storage: string; volume: string; sizeMiB: number; raw: string }
  | { kind: 'ct-rootfs'; storage: string; volume: string; sizeMiB: number; raw: string }
  | { kind: 'ct-mp'; slot: string; storage: string; volume: string; sizeMiB: number; mountpoint: string; raw: string };

const VM_BUSES = ['scsi', 'virtio', 'sata', 'ide'] as const;
type VmBus = (typeof VM_BUSES)[number];
const VM_SLOT = new RegExp(`^(${VM_BUSES.join('|')})(\\d+)$`);
const MP_SLOT = /^mp(\d+)$/;

function parseSize(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([MGT])$/.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (unit === 'M') return Math.round(n);
  if (unit === 'G') return Math.round(n * 1024);
  return Math.round(n * 1024 * 1024);
}

function parseFirstField(value: string): { storage: string; volume: string } | null {
  const first = value.split(',')[0];
  const colon = first.indexOf(':');
  if (colon < 1 || colon === first.length - 1) return null;
  return { storage: first.slice(0, colon), volume: first.slice(colon + 1) };
}

function extractKv(value: string, key: string): string | null {
  for (const part of value.split(',').slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === key) return part.slice(eq + 1);
  }
  return null;
}

export function parseVolume(configKey: string, configValue: string): VolumeDescriptor | null {
  if (!configValue) return null;
  const first = parseFirstField(configValue);
  if (!first) return null;
  const sizeRaw = extractKv(configValue, 'size');
  if (sizeRaw === null) return null;
  const sizeMiB = parseSize(sizeRaw);
  if (sizeMiB === null) return null;

  const vm = VM_SLOT.exec(configKey);
  if (vm) {
    return { kind: 'vm-disk', slot: configKey, bus: vm[1] as VmBus, storage: first.storage, volume: first.volume, sizeMiB, raw: configValue };
  }
  if (configKey === 'rootfs') {
    return { kind: 'ct-rootfs', storage: first.storage, volume: first.volume, sizeMiB, raw: configValue };
  }
  if (MP_SLOT.test(configKey)) {
    const mp = extractKv(configValue, 'mp');
    if (!mp) return null;
    return { kind: 'ct-mp', slot: configKey, storage: first.storage, volume: first.volume, sizeMiB, mountpoint: mp, raw: configValue };
  }
  return null;
}

export function formatVolumeSize(mib: number): string {
  if (mib >= 1024 * 1024 && mib % (1024 * 1024) === 0) {
    return `${mib / (1024 * 1024)} TiB`;
  }
  if (mib >= 1024) {
    const gib = mib / 1024;
    const str = Number.isInteger(gib) ? String(gib) : gib.toFixed(2).replace(/\.?0+$/, '');
    return `${str} GiB`;
  }
  return `${mib} MiB`;
}

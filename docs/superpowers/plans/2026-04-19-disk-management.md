# Disk Management (Resize / Add / Remove) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship disk-management parity with native PVE — Resize + Add + Remove(detach-or-delete) — on VM detail and CT detail pages. Ships as **0.26.0**.

**Architecture:** One pure parser (`lib/disk/parse.ts`) is the isolation boundary; every dialog consumes `VolumeDescriptor`, never raw config strings. Three modal dialogs sit inside a shared `<DisksSection>` placed on both VM and CT detail pages. All writes go through the existing `/api/proxmox/[...path]` proxy via the established `useCsrfMutation` + `api.vms`/`api.containers` client, plus two new client helpers for PVE `/resize`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, TanStack Query 5, existing `UnitInput` / `ModalShell` / `useCsrfMutation` primitives, PVE 8.x API.

**Deliberate template deviation:** TDD applies fully to Task 1 (pure parser). Tasks 2–6 are UI glue over PVE endpoints that require a live Proxmox host to verify end-to-end — the codebase has no React component tests and adding RTL is explicitly out of spec scope. For those tasks, verification is: tsc clean, lint clean, existing test suite unchanged, plus a manual-verification click-path in the commit body. The 7-scenario manual checklist must be signed off by the operator before Task 7 (release).

**Spec:** `docs/superpowers/specs/2026-04-19-disk-management-design.md`

---

## File Structure

**New files:**
- `nexus/src/lib/disk/parse.ts` — pure parser, exports `VolumeDescriptor`, `parseVolume`, `formatVolumeSize`.
- `nexus/src/lib/disk/parse.test.ts` — parser + formatter tests.
- `nexus/src/components/disk/DisksSection.tsx` — presentation shell.
- `nexus/src/components/disk/ResizeDiskDialog.tsx` — resize modal.
- `nexus/src/components/disk/AddDiskDialog.tsx` — add modal.
- `nexus/src/components/disk/RemoveDiskDialog.tsx` — remove modal.

**Modified files:**
- `nexus/src/lib/proxmox-client.ts` — add `vms.resize` and `containers.resize`.
- `nexus/src/app/(app)/dashboard/vms/[node]/[vmid]/page.tsx` — swap inline Disks block for `<DisksSection type="qemu">`.
- `nexus/src/app/(app)/dashboard/cts/[node]/[vmid]/page.tsx` — add `<DisksSection type="lxc">`.
- `nexus/package.json` — version bump to 0.26.0 (Task 7 only).

---

## Phase 0 — Preflight

- [ ] **Step 0.1: Confirm on `main`, working tree clean.**
  Command: `git -C /Users/devlin/Documents/GitHub/Proxmox status`
  Expected: `On branch main`, `nothing to commit, working tree clean`.

- [ ] **Step 0.2: Baseline build.**
  From `nexus/`:
  - `npx tsc --noEmit` → exit 0
  - `npm run lint` → exit 0
  - `npm test` → 402/402 pass

- [ ] **Step 0.3: Refresh GitNexus index.**
  From repo root: `npx gitnexus analyze --embeddings`. Expected: clean run.

---

## Task 1 — Pure parser (TDD)

**Files:**
- Create: `nexus/src/lib/disk/parse.ts`
- Create: `nexus/src/lib/disk/parse.test.ts`

- [ ] **Step 1.1: Write the test file first.**

Create `nexus/src/lib/disk/parse.test.ts`:

```ts
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
```

- [ ] **Step 1.2: Run the test — expect failure because `./parse.ts` doesn't exist yet.**
  From `nexus/`: `node --import tsx --test src/lib/disk/parse.test.ts`
  Expected: cannot find module.

- [ ] **Step 1.3: Implement `parse.ts`.**

Create `nexus/src/lib/disk/parse.ts`:

```ts
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
```

- [ ] **Step 1.4: Run the test again — expect PASS.**
  From `nexus/`: `node --import tsx --test src/lib/disk/parse.test.ts`. Expected: all suites pass.

- [ ] **Step 1.5: Full verify.**
  From `nexus/`: `npx tsc --noEmit` && `npm run lint` && `npm test`. All three exit 0.

- [ ] **Step 1.6: Commit.**
  Stage: `git -C /Users/devlin/Documents/GitHub/Proxmox add nexus/src/lib/disk/parse.ts nexus/src/lib/disk/parse.test.ts`
  Commit message: `feat(disk): pure VolumeDescriptor parser for PVE disk/volume strings` with a body describing the discriminated union and tests.

---

## Task 2 — Resize client helpers + ResizeDiskDialog

**Files:**
- Modify: `nexus/src/lib/proxmox-client.ts`
- Create: `nexus/src/components/disk/ResizeDiskDialog.tsx`

- [ ] **Step 2.1: Add client helpers.**

In `nexus/src/lib/proxmox-client.ts`, inside `api.vms` add (after the `snapshot: { ... },` block):

```ts
    resize: (node: string, vmid: number, disk: string, size: string) =>
      proxmox.put<string>(
        `nodes/${node}/qemu/${vmid}/resize`,
        { disk, size },
      ),
```

And inside `api.containers` (after its `updateConfig`):

```ts
    resize: (node: string, vmid: number, disk: string, size: string) =>
      proxmox.put<string>(
        `nodes/${node}/lxc/${vmid}/resize`,
        { disk, size },
      ),
```

- [ ] **Step 2.2: Create `ResizeDiskDialog.tsx`.**

Before writing this file, open `nexus/src/lib/create-csrf-mutation.ts` and read the actual `useCsrfMutation` option names. The plan assumes `url` / `method` / `buildBody` / `invalidateKeys` / `onSuccess`. If the real names differ, adapt this dialog's options accordingly — the hook is the authority.

Create `nexus/src/components/disk/ResizeDiskDialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/ui/modal-shell';
import { UnitInput } from '@/components/ui/unit-input';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import { formatVolumeSize, type VolumeDescriptor } from '@/lib/disk/parse';

export interface ResizeDiskDialogProps {
  open: boolean;
  onClose: () => void;
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  volume: VolumeDescriptor;
}

export function ResizeDiskDialog({ open, onClose, type, node, vmid, volume }: ResizeDiskDialogProps) {
  const currentMiB = volume.sizeMiB;
  const [newMiB, setNewMiB] = useState<number>(currentMiB);
  const diskSlot = volume.kind === 'ct-rootfs' ? 'rootfs' : volume.slot;

  const mutation = useCsrfMutation<string, void>({
    url: () =>
      type === 'qemu'
        ? `/api/proxmox/nodes/${encodeURIComponent(node)}/qemu/${vmid}/resize`
        : `/api/proxmox/nodes/${encodeURIComponent(node)}/lxc/${vmid}/resize`,
    method: 'PUT',
    buildBody: () => {
      const deltaMiB = newMiB - currentMiB;
      const deltaGiB = Math.ceil(deltaMiB / 1024);
      return { disk: diskSlot, size: `+${deltaGiB}G` };
    },
    invalidateKeys: () => [['config', node, vmid]],
    onSuccess: () => {
      onClose();
      const hint =
        type === 'qemu'
          ? `Disk grown to ${formatVolumeSize(newMiB)}. Log into the VM and run 'sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1' (or equivalent) to expand the filesystem.`
          : `${diskSlot} grown to ${formatVolumeSize(newMiB)}. The filesystem has been expanded automatically.`;
      console.info('[disk]', hint);
    },
  });

  const deltaMiB = newMiB - currentMiB;
  const invalid = deltaMiB <= 0;
  const errorText = mutation.error
    ? mutation.error instanceof Error
      ? mutation.error.message
      : String(mutation.error)
    : null;

  return (
    <ModalShell open={open} onClose={onClose} title={`Resize ${diskSlot}`} size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Current size: {formatVolumeSize(currentMiB)} on {volume.storage}
        </p>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">New size</span>
          <UnitInput
            value={Math.round(newMiB / 1024)}
            canonicalUnit="GiB"
            onChange={(gib) => setNewMiB(gib * 1024)}
            min={Math.ceil(currentMiB / 1024)}
            units={['GiB', 'TiB']}
            ariaLabel="New disk size"
          />
          {invalid && (
            <p className="text-xs text-[var(--color-err)] mt-1">
              New size must be greater than {formatVolumeSize(currentMiB)}.
            </p>
          )}
        </label>
        {errorText && (
          <p className="text-sm text-[var(--color-err)] bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg px-3 py-2">
            {errorText}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={mutation.isPending} className="px-4 py-2 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg disabled:opacity-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={invalid || mutation.isPending} className="px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm font-medium rounded-lg transition disabled:opacity-50">
            {mutation.isPending ? 'Resizing…' : 'Resize'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 2.3: Verify.** From `nexus/`: tsc, lint, test — all exit 0.

- [ ] **Step 2.4: Impact check before commit.** Run `gitnexus_detect_changes({ scope: "unstaged" })`. Expected: LOW or MEDIUM risk, affected files only in `nexus/src/lib/disk/`, `proxmox-client.ts`, `components/disk/`.

- [ ] **Step 2.5: Commit.** Stage the client change and dialog. Message: `feat(disk): resize dialog + client helpers`. Body notes the manual verification steps (scenarios 1 and 4 from Task 7).

---

## Task 3 — DisksSection + VM page wiring (resize-only first cut)

**Files:**
- Create: `nexus/src/components/disk/DisksSection.tsx`
- Modify: `nexus/src/app/(app)/dashboard/vms/[node]/[vmid]/page.tsx`

- [ ] **Step 3.1: Create `DisksSection.tsx`.**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus, HardDrive } from 'lucide-react';
import { parseVolume, formatVolumeSize, type VolumeDescriptor } from '@/lib/disk/parse';
import { ResizeDiskDialog } from './ResizeDiskDialog';

export interface DisksSectionProps {
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  config: Record<string, unknown>;
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'resize'; volume: VolumeDescriptor };

function describeSlot(v: VolumeDescriptor): string {
  if (v.kind === 'ct-rootfs') return 'rootfs';
  return v.slot;
}

export function DisksSection({ type, node, vmid, config }: DisksSectionProps) {
  const volumes = useMemo(() => {
    const acc: VolumeDescriptor[] = [];
    for (const [k, v] of Object.entries(config ?? {})) {
      if (typeof v !== 'string') continue;
      const parsed = parseVolume(k, v);
      if (parsed) acc.push(parsed);
    }
    return acc.sort((a, b) => describeSlot(a).localeCompare(describeSlot(b)));
  }, [config]);

  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const title = type === 'qemu' ? 'Disks' : 'Volumes';
  const addLabel = type === 'qemu' ? 'Add Disk' : 'Add Volume';

  return (
    <div className="studio-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button disabled title="Coming in Task 4" className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-xs rounded-lg opacity-50 cursor-not-allowed">
          <Plus className="w-3.5 h-3.5" />
          {addLabel}
        </button>
      </div>
      {volumes.length === 0 ? (
        <p className="text-sm text-[var(--color-fg-faint)]">No volumes configured.</p>
      ) : (
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {volumes.map((v) => {
            const slotLabel = describeSlot(v);
            return (
              <div key={slotLabel} className="flex items-center gap-3 py-2">
                <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--color-fg-secondary)]">
                    {slotLabel}
                    <span className="text-[var(--color-fg-faint)] ml-2">{v.storage}:{v.volume}</span>
                  </p>
                  {v.kind === 'ct-mp' && (
                    <p className="text-xs text-[var(--color-fg-faint)]">mounted at {v.mountpoint}</p>
                  )}
                </div>
                <span className="text-sm text-[var(--color-fg-secondary)] tabular">{formatVolumeSize(v.sizeMiB)}</span>
                <div className="relative">
                  <button onClick={() => setMenuFor(menuFor === slotLabel ? null : slotLabel)} aria-label={`Actions for ${slotLabel}`} className="p-1 rounded hover:bg-[var(--color-overlay)] transition">
                    <MoreHorizontal className="w-4 h-4 text-[var(--color-fg-subtle)]" />
                  </button>
                  {menuFor === slotLabel && (
                    <div className="absolute right-0 top-7 z-10 min-w-[140px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg shadow-lg py-1">
                      <button onClick={() => { setMenuFor(null); setDialog({ kind: 'resize', volume: v }); }} className="block w-full text-left px-3 py-1.5 text-sm text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)]">
                        Resize
                      </button>
                      <button disabled title="Coming in Task 5" className="block w-full text-left px-3 py-1.5 text-sm text-[var(--color-fg-faint)] opacity-50 cursor-not-allowed">
                        Remove…
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {dialog.kind === 'resize' && (
        <ResizeDiskDialog
          open
          onClose={() => setDialog({ kind: 'closed' })}
          type={type}
          node={node}
          vmid={vmid}
          volume={dialog.volume}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3.2: Swap the inline Disks block on VM detail.**

In `nexus/src/app/(app)/dashboard/vms/[node]/[vmid]/page.tsx`:

1. Add import near the other component imports: `import { DisksSection } from '@/components/disk/DisksSection';`
2. Find the existing inline Disks block (the `studio-card` that starts near `{diskSlots.length > 0 && (` around line 471). Replace the whole card with: `<DisksSection type="qemu" node={node} vmid={Number(vmid)} config={config} />`
3. If the `diskSlots` computation above is now unused, remove it.

- [ ] **Step 3.3: Verify.** From `nexus/`: tsc, lint, test — all exit 0.

- [ ] **Step 3.4: Commit.** Stage the two files. Message: `feat(disk): DisksSection with resize wired on VM detail`. Body notes manual verification (scenario 1).

---

## Task 4 — AddDiskDialog

**Files:**
- Create: `nexus/src/components/disk/AddDiskDialog.tsx`
- Modify: `nexus/src/components/disk/DisksSection.tsx`

- [ ] **Step 4.1: Create `AddDiskDialog.tsx`.**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ModalShell } from '@/components/ui/modal-shell';
import { UnitInput } from '@/components/ui/unit-input';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import { api } from '@/lib/proxmox-client';

export interface AddDiskDialogProps {
  open: boolean;
  onClose: () => void;
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  config: Record<string, unknown>;
}

const VM_BUSES = ['virtio', 'scsi', 'sata', 'ide'] as const;
const VM_FORMATS = ['raw', 'qcow2', 'vmdk'] as const;

export function AddDiskDialog({ open, onClose, type, node, vmid, config }: AddDiskDialogProps) {
  const { data: storages } = useQuery({
    queryKey: ['node', node, 'storage'],
    queryFn: () => api.storage.list(node),
    enabled: open,
  });
  const compatibleStorages = (storages ?? []).filter((s) =>
    type === 'qemu'
      ? !s.content || s.content.includes('images')
      : !s.content || s.content.includes('rootdir'),
  );

  const [storage, setStorage] = useState('');
  const [sizeGiB, setSizeGiB] = useState(32);
  const [format, setFormat] = useState<(typeof VM_FORMATS)[number]>('raw');
  const [bus, setBus] = useState<(typeof VM_BUSES)[number]>('virtio');
  const [mountpoint, setMountpoint] = useState('');

  const slot = useMemo(() => {
    if (type === 'qemu') {
      for (let i = 0; i < 31; i++) {
        const key = `${bus}${i}`;
        if (!(key in (config ?? {}))) return key;
      }
      return `${bus}0`;
    }
    for (let i = 0; i < 256; i++) {
      const key = `mp${i}`;
      if (!(key in (config ?? {}))) return key;
    }
    return 'mp0';
  }, [type, bus, config]);

  const mountpointValid = type === 'qemu' || (mountpoint.startsWith('/') && mountpoint !== '/');
  const canSubmit = !!storage && sizeGiB >= 1 && (type === 'qemu' || mountpointValid);

  const mutation = useCsrfMutation<null, void>({
    url: () =>
      type === 'qemu'
        ? `/api/proxmox/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`
        : `/api/proxmox/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`,
    method: 'PUT',
    buildBody: () => {
      if (type === 'qemu') {
        return { [slot]: `${storage}:${sizeGiB},format=${format}` };
      }
      return { [slot]: `${storage}:${sizeGiB},mp=${mountpoint}` };
    },
    invalidateKeys: () => [['config', node, vmid]],
    onSuccess: () => onClose(),
  });

  const errorText = mutation.error
    ? mutation.error instanceof Error ? mutation.error.message : String(mutation.error)
    : null;

  return (
    <ModalShell open={open} onClose={onClose} title={type === 'qemu' ? 'Add Disk' : 'Add Volume'} size="lg">
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Storage</span>
          <select value={storage} onChange={(e) => setStorage(e.target.value)} className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]">
            <option value="">Select storage…</option>
            {compatibleStorages.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Size</span>
          <UnitInput value={sizeGiB} canonicalUnit="GiB" onChange={setSizeGiB} min={1} units={['GiB', 'TiB']} ariaLabel="New disk size" />
        </label>
        {type === 'qemu' && (
          <>
            <label className="block">
              <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as (typeof VM_FORMATS)[number])} className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]">
                {VM_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <p className="text-xs text-[var(--color-fg-faint)] mt-1">Raw is fastest; QCOW2 supports snapshots on file-backed storage.</p>
            </label>
            <label className="block">
              <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Bus</span>
              <select value={bus} onChange={(e) => setBus(e.target.value as (typeof VM_BUSES)[number])} className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]">
                {VM_BUSES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <p className="text-xs text-[var(--color-fg-faint)] mt-1">Virtio is fastest for Linux. SCSI for broad guest support. IDE only for legacy OSes.</p>
            </label>
          </>
        )}
        {type === 'lxc' && (
          <label className="block">
            <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Mount path</span>
            <input type="text" value={mountpoint} onChange={(e) => setMountpoint(e.target.value)} placeholder="/data" className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]" />
            {!mountpointValid && mountpoint && (
              <p className="text-xs text-[var(--color-err)] mt-1">Mount path must start with / and cannot be the root /.</p>
            )}
          </label>
        )}
        <p className="text-xs text-[var(--color-fg-faint)]">
          Will be created as <code className="text-[var(--color-fg-secondary)]">{slot}</code>.
        </p>
        {errorText && (
          <p className="text-sm text-[var(--color-err)] bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg px-3 py-2">{errorText}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={mutation.isPending} className="px-4 py-2 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg disabled:opacity-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm font-medium rounded-lg transition disabled:opacity-50">
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 4.2: Wire the Add button in `DisksSection.tsx`.**

1. Import: `import { AddDiskDialog } from './AddDiskDialog';`
2. Extend `DialogState`: add `| { kind: 'add' }`.
3. Replace the disabled Add button with an active one that calls `setDialog({ kind: 'add' })`, using `bg-[var(--color-cta)]` styling.
4. After the resize dialog conditional, add `{dialog.kind === 'add' && <AddDiskDialog open onClose={() => setDialog({ kind: 'closed' })} type={type} node={node} vmid={vmid} config={config} />}`.

- [ ] **Step 4.3: Verify.** From `nexus/`: tsc, lint, test — all exit 0.

- [ ] **Step 4.4: Commit.** Stage both files. Message: `feat(disk): add-disk dialog`. Body notes manual verification (scenarios 5 and 6).

---

## Task 5 — RemoveDiskDialog

**Files:**
- Create: `nexus/src/components/disk/RemoveDiskDialog.tsx`
- Modify: `nexus/src/components/disk/DisksSection.tsx`

- [ ] **Step 5.1: Create `RemoveDiskDialog.tsx`.**

```tsx
'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/ui/modal-shell';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import { formatVolumeSize, type VolumeDescriptor } from '@/lib/disk/parse';

export interface RemoveDiskDialogProps {
  open: boolean;
  onClose: () => void;
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  volume: VolumeDescriptor;
}

type Mode = 'detach' | 'delete';

export function RemoveDiskDialog({ open, onClose, type, node, vmid, volume }: RemoveDiskDialogProps) {
  const [mode, setMode] = useState<Mode>('detach');
  const slot = volume.kind === 'ct-rootfs' ? 'rootfs' : volume.slot;

  const configUrl =
    type === 'qemu'
      ? `/api/proxmox/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`
      : `/api/proxmox/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`;

  const mutation = useCsrfMutation<null, void>({
    url: () => configUrl,
    method: 'PUT',
    buildBody: () => ({ delete: slot }),
    invalidateKeys: () => [['config', node, vmid]],
    onSuccess: () => {
      if (mode === 'detach') {
        onClose();
        return;
      }
      void finaliseDelete();
    },
  });

  // Second-leg of a Delete: re-read config, find the unusedN entry PVE
  // created when we detached, and delete it. This mirrors what PVE's
  // own UI does for "Remove with destroy volume".
  async function finaliseDelete(): Promise<void> {
    try {
      const res = await fetch(configUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`Config re-read failed: ${res.status}`);
      const data = (await res.json()) as { data?: Record<string, unknown> };
      const cfg = data.data ?? {};
      const unusedKey = Object.keys(cfg).find((k) => k.startsWith('unused'));
      if (!unusedKey) {
        onClose();
        return;
      }
      const csrfToken = document.cookie.split('; ').find((c) => c.startsWith('CSRFPreventionToken='))?.split('=')[1];
      const delRes = await fetch(configUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: csrfToken ? { 'CSRFPreventionToken': csrfToken, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: unusedKey }),
      });
      if (!delRes.ok) throw new Error(`Destroy volume failed: ${delRes.status}`);
      onClose();
    } catch (err) {
      console.error('[disk] delete-finalise failed', err);
      onClose();
    }
  }

  const errorText = mutation.error
    ? mutation.error instanceof Error ? mutation.error.message : String(mutation.error)
    : null;
  const destruct = mode === 'delete';

  return (
    <ModalShell open={open} onClose={onClose} title={`Remove ${slot}`} size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-fg-subtle)]">
          {slot} on {volume.storage} ({formatVolumeSize(volume.sizeMiB)})
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <input type="radio" name="remove-mode" value="detach" checked={mode === 'detach'} onChange={() => setMode('detach')} className="mt-0.5" />
            <span>
              <span className="block text-sm text-[var(--color-fg-secondary)]">Detach — keep volume on storage</span>
              <span className="block text-xs text-[var(--color-fg-faint)]">The disk is unplugged from this guest. The volume stays on {volume.storage} and can be re-attached later.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="remove-mode" value="delete" checked={mode === 'delete'} onChange={() => setMode('delete')} className="mt-0.5" />
            <span>
              <span className="block text-sm text-[var(--color-err)]">Delete — volume will be destroyed</span>
              {destruct && (
                <span className="block text-xs text-[var(--color-err)]">The volume file on {volume.storage} will be destroyed. This cannot be undone.</span>
              )}
            </span>
          </label>
        </div>
        {errorText && (
          <p className="text-sm text-[var(--color-err)] bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg px-3 py-2">{errorText}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={mutation.isPending} className="px-4 py-2 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg disabled:opacity-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className={`px-4 py-2 text-sm font-medium rounded-lg transition disabled:opacity-50 ${destruct ? 'bg-[var(--color-err)] hover:opacity-90 text-white' : 'bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)]'}`}>
            {mutation.isPending ? 'Removing…' : destruct ? 'Delete' : 'Detach'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 5.2: Wire Remove in `DisksSection.tsx`.**

1. Import `RemoveDiskDialog`.
2. Extend `DialogState`: add `| { kind: 'remove'; volume: VolumeDescriptor }`.
3. Replace the disabled Remove button in the row menu with an active button that calls `setDialog({ kind: 'remove', volume: v })` on click and is `disabled={v.kind === 'ct-rootfs'}` with a tooltip explaining rootfs cannot be removed.
4. Below the add dialog conditional, mount `<RemoveDiskDialog>` when `dialog.kind === 'remove'`.

- [ ] **Step 5.3: Verify.** tsc, lint, test — all exit 0.

- [ ] **Step 5.4: Commit.** Stage both files. Message: `feat(disk): remove dialog with detach / delete radio`. Body notes manual verification (scenario 7).

---

## Task 6 — CT detail page wiring

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/cts/[node]/[vmid]/page.tsx`

- [ ] **Step 6.1: Insert `<DisksSection type="lxc">` after the existing Resources card.** Add import `import { DisksSection } from '@/components/disk/DisksSection';` and mount the component with the same prop shape used on VM detail.

- [ ] **Step 6.2: Verify.** tsc, lint, test — all exit 0.

- [ ] **Step 6.3: Commit.** Message: `feat(disk): surface DisksSection on CT detail page`. Body notes manual verification (scenarios 2 and 3).

---

## Task 7 — Release gated on manual verification

This task does NOT run until the operator has exercised the 7-scenario manual checklist on a live PVE.

**Scenarios to exercise before Task 7:**
1. Grow VM disk from current to current+10 GiB. Success + resize2fs hint.
2. Grow CT rootfs from current to current+8 GiB. Success + "filesystem expanded automatically" message.
3. Grow a CT `mp0` from current to current+8 GiB. (Skip if no mountpoints exist on test CTs.)
4. Attempt a shrink — submit button disabled with "must be greater than" inline error.
5. Add a new VM disk on `virtio` bus, 8 GiB, raw. New slot appears.
6. Add a CT `mp0` at `/data`, 8 GiB. New mount row appears.
7. Remove a disk via Detach (volume stays in PVE storage as unused), then via Delete on a different test disk (volume destroyed).

- [ ] **Step 7.1: Wait for operator signoff.** If any scenario fails, stop, fix, re-test.

- [ ] **Step 7.2: Bump `nexus/package.json` line 3 to `"version": "0.26.0",`**.

- [ ] **Step 7.3: Commit.** Message: `chore(release): v0.26.0 — disk management (resize/add/remove)`. Body lists the three actions and notes the intentionally-deferred items (move_disk, reassign bus, typed-confirmation, advanced add options).

- [ ] **Step 7.4: Tag and push.**
  - `git -C /Users/devlin/Documents/GitHub/Proxmox tag -a v0.26.0 -m "v0.26.0 — disk management"`
  - `git -C /Users/devlin/Documents/GitHub/Proxmox push origin main`
  - `git -C /Users/devlin/Documents/GitHub/Proxmox push origin v0.26.0`

Expected: both pushes succeed; release workflow fires on the tag push.

---

## Self-review

**Spec coverage** — every requirement in `docs/superpowers/specs/2026-04-19-disk-management-design.md` traces to a task:
- Resize across VM disks, CT rootfs, CT mountpoints: Tasks 2 + 3 + 6.
- Add VM disk, CT mountpoint: Task 4.
- Remove via detach-or-delete: Task 5 (two-leg delete explicit).
- Parser as isolation boundary: Task 1.
- UnitInput absolute-size + shrink rejection: Task 2.
- Post-resize hints (VM vs CT): Task 2.
- Radio-gated Delete with red copy: Task 5.
- Single-commit-per-component: Tasks 1–7.
- Release gated on manual signoff: Task 7 Step 7.1.

**Placeholder scan** — all code blocks are complete. `useCsrfMutation` option names are flagged for verification against the real hook in Step 2.2 (they may need `mutationFn` instead of `url`/`method`/`buildBody` depending on actual signature).

**Type consistency** — `VolumeDescriptor` defined in Task 1, consumed identically across Tasks 2–5. All dialog props take `{ open, onClose, type, node, vmid, volume|config }` with matching types.

**Template deviation** declared at the top: TDD applies to Task 1 only; Tasks 2–6 rely on tsc/lint/existing-tests + manual PVE verification; Task 7 release is operator-gated.

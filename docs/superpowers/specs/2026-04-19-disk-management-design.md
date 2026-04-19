# Disk Management (Resize / Add / Remove) — VMs and CTs

**Date:** 2026-04-19
**Status:** Approved for implementation
**Ships as:** 0.26.0

## Problem

Nexus ships VM and CT creation via the wizard but has no UI for disk-level changes on existing guests. Users cannot resize a disk, add a new disk/mountpoint, or remove one. PVE's native UI has all three; Nexus's stated goal in `CLAUDE.md` is 1:1 parity with native PVE for core operations.

This is a parity gap, not a bug in code that already exists. Shipping it closes the most obvious missing action in the guest-management surface — grow storage when you run out.

## Goal

Add disk management (Resize, Add, Remove-via-detach-or-delete) on VM detail and CT detail pages, covering VM disks, CT rootfs, and CT mountpoints.

## Scope

### In scope for 0.26.0

- **Resize** for: VM disks (`scsiN`, `virtioN`, `sataN`, `ideN`), CT `rootfs`, CT mountpoints (`mpN`). Grow-only; shrinks rejected client-side.
- **Add** a new disk/volume: VM disk on any bus + slot, CT mountpoint (`mpN`). No add-disk flow for CT rootfs (it's implicit on CT creation).
- **Remove** via a single "Remove" action with a radio choice between **Detach** (keep volume on storage; default) and **Delete** (destroy volume; irreversible).

### Out of scope (deferred to later releases)

- **Move disk / Move volume** to a different storage pool. Specialist operation; waits for the parity audit to confirm priority.
- **Reassign bus / change bus**. Rare.
- **Type-to-confirm** gate on Delete. The radio + red helper text is the pre-flight barrier. Revisit if real-world use shows accidental deletes.
- **Add-disk advanced options** (IO thread, cache mode, SSD emulation). Modal leaves room to add later without layout rework.
- **VM filesystem expansion** inside the guest. Post-resize success toast tells the user what to run; we do not touch the guest OS.
- **Parallel action safety beyond PVE's own digest-based conflict rejection**. If two operators edit the same guest simultaneously, the second gets 409 and is asked to refresh — no custom locking.
- **Snapshots-block-detach pre-flight.** We let PVE reject and surface the friendlier error; we do not probe snapshots before submit.

## Architecture

Three new dialogs + one new presentation section, all consuming the existing Proxmox API proxy (`/api/proxmox/[...path]`). No new server-side routes. No new persistence. PVE task UPIDs flow through the existing task-watcher; no new task infrastructure.

Code lives in:
- `nexus/src/components/disk/` — dialogs and the shared section.
- `nexus/src/lib/disk/` — pure parser.

The parser is the isolation boundary. Every dialog consumes `VolumeDescriptor`; none touch raw config strings.

## Components

### `lib/disk/parse.ts` — pure parser/serialiser

Exports:
- `parseVolume(configKey: string, configValue: string): VolumeDescriptor | null`
- `formatVolumeSize(mib: number): string`

```ts
export type VolumeDescriptor =
  | { kind: 'vm-disk'; slot: string; bus: 'scsi'|'virtio'|'sata'|'ide'; storage: string; volume: string; sizeMiB: number; raw: string }
  | { kind: 'ct-rootfs'; storage: string; volume: string; sizeMiB: number; raw: string }
  | { kind: 'ct-mp'; slot: string; storage: string; volume: string; sizeMiB: number; mountpoint: string; raw: string };
```

No React. No PVE client. Exhaustively tested by `parse.test.ts`.

### `components/disk/DisksSection.tsx` — presentation shell

Props: `{ type: 'qemu'|'lxc'; node: string; vmid: number; config: GuestConfig; onRefresh: () => void }`.

Walks `config`, runs every `scsiN/virtioN/sataN/ideN/rootfs/mpN` key through `parseVolume`, renders one row per descriptor showing: slot/role, storage:volume, size (human-readable), and a `⋯` menu.

Menu items per row:
- **Resize** → opens `<ResizeDiskDialog>`
- **Remove** → opens `<RemoveDiskDialog>`. Disabled for `ct-rootfs` (rootfs cannot be removed from a running CT; it's implicit to the CT).

Header: left-side "Disks" or "Volumes" title; right-side "Add Disk" (VM) or "Add Volume" (CT) button → opens `<AddDiskDialog>`.

### `components/disk/ResizeDiskDialog.tsx` — modal

Single field: `<UnitInput canonicalUnit="GiB" value={newSizeGiB} min={currentSizeGiB} units={['GiB','TiB']} />`.

Submit computes the delta:
```ts
const deltaMiB = newSizeMiB - volume.sizeMiB;
if (deltaMiB <= 0) { /* form error: "New size must be greater than current" */ return; }
const body = { disk: volume.slot /* or 'rootfs'/'mp0' */, size: `+${Math.ceil(deltaMiB / 1024)}G` };
```

POSTs to `/api/proxmox/nodes/{node}/{qemu|lxc}/{vmid}/resize` with that body.

On success:
- For `kind: 'vm-disk'`, toast reads: *"Disk grown to {N} GiB. Log into the VM and run `sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1` (or equivalent) to expand the filesystem."*
- For CT rootfs / CT mp: toast reads: *"{Volume} grown to {N} GiB. The filesystem has been expanded automatically."*

Invalidates `['config', node, vmid]`.

### `components/disk/AddDiskDialog.tsx` — modal

Fields:
- **Storage** — `<Select>` populated from `/api/proxmox/nodes/{node}/storage`, filtered by `content` (`images` for VMs, `rootdir` for CTs). Validator: required.
- **Size** — `<UnitInput canonicalUnit="GiB" min={1} units={['GiB','TiB']} />`.
- **Format** (VM only) — `<Select>` of `raw` / `qcow2` / `vmdk`. Default `raw`. Helper text: *"Raw is fastest; QCOW2 supports snapshots on file-backed storage."*
- **Bus** (VM only) — `<Select>` of `scsi` / `virtio` / `sata` / `ide`. Default `virtio`. Helper text: *"Virtio is fastest for Linux. SCSI for broad guest support. IDE only for legacy OSes."*
- **Slot** — read-only, computed from the first free index on the selected bus (VMs) or the first free `mpN` (CTs). Displayed so the user sees what they're creating.
- **Mountpoint path** (CT only) — `<Input>`, required, must start with `/`, must not be `/`. Validator inline.

Submit PUTs to `/api/proxmox/nodes/{node}/{qemu|lxc}/{vmid}/config` with the built config string (e.g. `{ scsi1: 'local-lvm:32,format=raw' }` or `{ mp0: 'local-lvm:32,mp=/data' }`). Invalidates `['config', node, vmid]`.

### `components/disk/RemoveDiskDialog.tsx` — modal

Title: *"Remove {slot}"*. Body: short sentence identifying the volume (e.g. *"scsi1 on local-lvm (32 GiB)"*).

Radio group:
- **Detach — keep volume on storage** (default). Helper: *"The disk will be unplugged from this guest. The volume stays on {storage} and can be re-attached later."*
- **Delete — volume will be destroyed** (red label). Helper (shown only when selected, in red): *"The volume file on {storage} will be destroyed. This cannot be undone."*

Submit PUTs to `/config`:
- **Detach**: `{ delete: slot }`. PVE unplugs the disk from the guest config and moves the volume to an "unused" slot on the same storage.
- **Delete**: two-step. First the detach PUT above; when that returns success, read the resulting config to find the new `unusedN` slot the volume landed in, then DELETE it. Nexus does both calls in one mutation — from the user's perspective there is one action. This matches PVE's own UI behaviour for "Remove with destroy volume" on qemu and lxc. The implementation plan will specify the exact endpoint sequence.

Invalidates `['config', node, vmid]`.

### VM detail page (`app/(app)/dashboard/vms/[node]/[vmid]/page.tsx`)

Replace the existing hand-rolled "Disks" block (around line 471 of the current file) with `<DisksSection type="qemu" node={node} vmid={vmid} config={config} onRefresh={refetchConfig} />`.

### CT detail page (`app/(app)/dashboard/cts/[node]/[vmid]/page.tsx`)

Add a new `<DisksSection type="lxc" node={node} vmid={vmid} config={config} onRefresh={refetchConfig} />` section, placed after the existing "Resources" card.

## Data flow

**Read.** Detail page already has a TanStack Query for `['config', node, vmid]`. `<DisksSection>` consumes that cache entry directly — no new fetches.

**Write.** Each dialog owns a `useCsrfMutation`. On success:
1. Dialog closes.
2. Success toast fires (with action-specific text).
3. `qc.invalidateQueries({ queryKey: ['config', node, vmid] })`.
4. If PVE returned a UPID, the existing recent-tasks watcher picks it up. No new wiring.

**Resize delta encoding.** The user picks an absolute new size (GiB) via UnitInput. Submit converts to MiB, computes `delta = new - current`, rejects ≤ 0, and sends `+${Math.ceil(delta/1024)}G` to PVE because PVE's resize endpoint accepts deltas in its unit-suffixed form. Rounding up by < 1 GiB is safe; undershooting would leave the guest short of requested space.

## Error handling

- **Pre-submit validation** (shrink, missing required field, bad mountpoint path): inline under the field; submit button disabled.
- **Post-submit PVE error**: surface the error string inside the dialog, not as a toast. User stays in context and can retry. Known friendlier translations: *"disk has snapshots, cannot detach"* → *"This disk has snapshots. Remove the snapshots first, then try again."*
- **Stale config (409 digest mismatch)**: show *"The guest configuration changed. Refreshing…"*, refetch, prompt the user to retry.
- **Network/CSRF failure**: existing `useCsrfMutation` error handling applies unchanged.

## Testing

**New test file: `lib/disk/parse.test.ts`.** Follows the existing `node --test` pattern. Cases:

1. VM disk, minimal: `scsi0=local-lvm:vm-100-disk-0,size=32G` → `{ kind: 'vm-disk', slot: 'scsi0', bus: 'scsi', storage: 'local-lvm', volume: 'vm-100-disk-0', sizeMiB: 32768, raw: ... }`.
2. VM disk with extras: `virtio0=local-lvm:vm-100-disk-1,size=100G,iothread=1,ssd=1` — parser ignores unknown flags, keeps `raw` for round-trip.
3. All four VM buses: scsi0, virtio0, sata0, ide0 each yield correct `bus`.
4. CT rootfs: `rootfs=local-lvm:subvol-100-disk-0,size=8G` → `{ kind: 'ct-rootfs', sizeMiB: 8192, ... }`.
5. CT mountpoint: `mp0=local-lvm:subvol-100-disk-1,size=32G,mp=/data` → `{ kind: 'ct-mp', slot: 'mp0', mountpoint: '/data', ... }`.
6. Size-unit round trip: `1T`, `1024G`, `524288M` all yield `sizeMiB = 1048576`.
7. Malformed inputs (missing size, unknown bus, empty value, non-storage prefix, unexpected key) → `null`, never throw.
8. `formatVolumeSize(32768)` → `"32 GiB"`; `formatVolumeSize(1048576)` → `"1 TiB"`; fractional remainders render correctly.

**No React component tests.** Matches existing project posture (zero RTL tests in the current suite). Tradeoff accepted: UI regressions in dialogs must be caught manually.

**Manual verification checklist** (included in the plan, not a test file). Seven scenarios, each with exact click-path:

1. Grow VM disk `scsi0` from 32 → 64 GiB. Expect success + resize2fs hint.
2. Grow CT `rootfs` from 8 → 16 GiB. Expect success + "filesystem expanded automatically" note.
3. Grow CT `mp0`. Same as (2).
4. Attempt to shrink: set new size < current. Expect submit button disabled + inline error.
5. Add a new VM disk on SCSI bus. Expect `scsi1` to appear in the table.
6. Add a CT `mp0` mountpoint. Expect to appear; mountpoint path validates.
7. Remove via Detach — disk disappears from table, volume still visible in PVE storage browser (user confirms manually). Remove via Delete — disk disappears and volume gone.

## Commit plan

One commit per component, matching the plan phases:

1. `lib/disk/parse.ts` + test.
2. `components/disk/DisksSection.tsx` (rendering only, no action dialogs yet, menu stubs to log).
3. `components/disk/ResizeDiskDialog.tsx` + VM detail page swap to `<DisksSection>`.
4. `components/disk/AddDiskDialog.tsx`.
5. `components/disk/RemoveDiskDialog.tsx`.
6. CT detail page wiring: add `<DisksSection type="lxc">`.
7. Release chore: bump to 0.26.0, tag, push.

## Non-goals (explicit)

- Not refactoring the VM/CT detail pages beyond swapping the one "Disks" block. Other cards stay as-is.
- Not adding React Testing Library.
- Not touching the Create VM / Create CT wizards.
- Not building Move Disk / Move Volume, even though some users will ask for it during testing.
- Not gating Delete behind a typed confirmation.
- Not probing for snapshots pre-flight; let PVE reject and surface the error.

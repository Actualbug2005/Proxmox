# Phase B2 — Storage / Restore Migration Landed

**Status:** Committed — `ca71083` on branch `refactor/pve-boolean-codec`
**Parent:** Phase B1 (`phase_b1_firewall_options_landed`)

## Pre-flight finding (gitnexus query)

`restore-dialog.tsx` is storage/backup-domain only. Imports confirm zero coupling to Network, HA, or cluster APIs:

| Import | Domain |
|---|---|
| `BackupFile`, `RestoreParams` | storage/backup types |
| `api` | `api.storage.list`, `api.backups.restoreVM/CT`, `api.cluster.nextid` |
| `react`, `@tanstack/react-query`, `ui/toast`, `lucide-react` | framework/UI |

Semantic query surfaced peer storage components (map-storage-dialog, backups-tab) but those are siblings, not dependencies — strict refactor safe.

## Scope

5 boundary keys migrated (per user-revised scope):

| Type | Keys | Endpoint(s) |
|---|---|---|
| `StorageCreatePayload` | `mkdir` | `api.storage.create`, `api.storage.update` (StorageUpdatePayload = partial of it) |
| `PVEStorageConfig` | inherits `mkdir` | `api.storage.get` (decodes) |
| `DiskListEntry` | `gpt` | `api.disks.list` (decodes per row) |
| `RestoreParams` | `force`, `unique`, `start` | `api.backups.restoreVM`, `api.backups.restoreCT` |

5 new Public types exported from `types/proxmox.ts`:
`StorageCreatePayloadPublic`, `StorageUpdatePayloadPublic`, `PVEStorageConfigPublic`, `DiskListEntryPublic`, `RestoreParamsPublic`.

## Codec bindings (proxmox-client.ts)

Pattern from Phase B1 re-applied, now with three per-domain key lists under a single "Storage / Restore Codec Bindings" section:

```ts
const STORAGE_CREATE_BOOL_KEYS = ['mkdir'] as const satisfies
  readonly (keyof StorageCreatePayload)[];
const DISK_LIST_BOOL_KEYS = ['gpt'] as const satisfies
  readonly (keyof DiskListEntry)[];
const RESTORE_BOOL_KEYS = ['force', 'unique', 'start'] as const satisfies
  readonly (keyof RestoreParams)[];
```

Wrapped helpers: `encodeStorageCreate`, `encodeStorageUpdate`, `decodeStorageConfig`, `decodeDiskList` (row-wise map), `encodeRestore`.

## Consumer fallout (4 UI files)

Type-level ripple caused 4 additional files to need tiny prop-type swaps:

- `map-storage-dialog.tsx` — **intentional deviation from user's UI scope**; `mkdir` is a boundary key and this dialog is its only consumer. Two inline conversions removed (line 118 read → `?? true`; line 206 write → direct assign).
- `storage/page.tsx` — `editTarget` state type swapped to `PVEStorageConfigPublic`.
- `physical-disks-table.tsx` — `DiskRow extends DiskListEntryPublic`; zero JSX changes because no UI reads `.gpt`.
- `restore-dialog.tsx` — 3 ternaries deleted, replaced by property shorthand (local state was already boolean).

## Out-of-scope notes

**VM action pages (`vms/[node]/[vmid]/page.tsx`)**: user's revised scope caveat — "If the Pre-flight step revealed heavy coupling, ensure you only mutate the storage-specific props." The VM page's `full`/`online`/`onboot` ternaries belong to `CloneVMParams`/`MigrateVMParams`/`UpdateVMConfigParams`, whose wire fields are loose `number`, not `PveBool`. None of their keys fall in the 5-key scope. Deliberately untouched.

**CT page onboot**: analogous pattern, same reason, same deferral.

**`backups.protect` endpoint in proxmox-client.ts** (line 687): still has `isProtected ? 1 : 0` inline — uses `BackupFile.protected` (wire PveBool) in body construction. Not covered by current scope (no explicit `protected` key in user's list). Queue.

## Verification

- ✅ `npx tsc --noEmit`: clean
- ✅ `npm test`: 14/14 pass (146ms, unchanged from B1)
- ✅ Grep confirms zero `? 1 : 0` or `=== 1` in `src/components/storage/**`
- ✅ Git diff stat: 6 files, 92 insertions / 32 deletions

## Known LSP quirk during implementation

The IDE's TypeScript language server lagged repeatedly during this phase, reporting stale errors about type names minutes after my edits fixed them. `tsc --noEmit` on the command line was ground truth. Two `replace_all` operations created accidental `PublicPublic` suffixes when the old string had already been edited — safe to replace_all only when the LSP shows the old pattern still exists, not when working from cached diagnostics. Lesson applied mid-phase.

## Next

Continuation options:
- **B3 (HA)**: `ha-group-editor.tsx` (restricted/nofailback), `ha-migrate-dialog.tsx` (`online === 1` read). Small surface.
- **B4 (Access)**: realms-tab (default/secure/autocreate), acl-tab (propagate), users-tab (enable). Dense.
- **Out-of-scope cleanup**: tighten `CloneVMParams`/`MigrateVMParams`/`UpdateVMConfigParams` `number` → `PveBool`, then migrate VM/CT pages in a follow-up.

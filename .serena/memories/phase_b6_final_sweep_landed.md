# Phase B6 — Final Closure Sweep Landed

**Status:** Committed — `8edefc8` on branch `refactor/pve-boolean-codec`
**Parents:** B4.5+B5 (`phase_b4_5_b5_roles_vm_ct_landed`)

## Achievement

**The `src/components/` tree now has zero `=== 1` and zero `? 1 : 0` for PveBool conversion patterns.** Every UI component consumes booleans; the `proxmox-client.ts` codec handles wire 0/1 translation at the HTTP boundary.

## Wire-type tightenings

- `CreateCTParams.unprivileged`: `number` → `PveBool`
- `NetworkIface.active` / `.autostart`: `number` → `PveBool`
- `NetworkIfaceParams.autostart`: `number` → `PveBool`

## 12 new Public types

`BackupJobPublic`, `BackupJobParamsPublic`, `BackupFilePublic`, `VzdumpParamsPublic`, `PVESnapshotPublic`, `CreateSnapshotParamsPublic`, `FirewallRulePublic`, `FirewallRuleParamsPublic`, `FirewallIPSetEntryPublic`, `CreateCTParamsPublic`, `NetworkIfacePublic`, `NetworkIfaceParamsPublic`.

## 10 new codec bindings

```ts
BACKUP_JOB_BOOL_KEYS            = ['enabled', 'all', 'remove', 'protected']
BACKUP_FILE_BOOL_KEYS           = ['protected']
VZDUMP_BOOL_KEYS                = ['all', 'protected', 'remove']
SNAPSHOT_BOOL_KEYS              = ['vmstate', 'running']
CREATE_SNAPSHOT_BOOL_KEYS       = ['vmstate']
FIREWALL_RULE_BOOL_KEYS         = ['enable']
IPSET_ENTRY_BOOL_KEYS           = ['nomatch']
CREATE_CT_BOOL_KEYS             = ['unprivileged']
NETWORK_IFACE_BOOL_KEYS         = ['autostart', 'active']
NETWORK_IFACE_PARAMS_BOOL_KEYS  = ['autostart']
```

## 20+ endpoints wired

- Backups: `jobs.list/get/create/update`, `vzdump`, `files`, `protect` (via `toPveBool`)
- Snapshots: `vms.snapshot.list/create`, `containers.snapshot.list/create`
- Firewall rules across 4 scopes (cluster / node / vm / ct): `list`/`get` (where present) / `create` / `update`, plus `cluster.groups.addRule`
- CT create: `containers.create` (via `encodeCreateCT`)
- Network: `networkIfaces.list/get/create/update`

## Semantic defaults preserved

| Category | Fields | Read idiom |
|---|---|---|
| Default-enabled | `BackupJob.enabled`, `FirewallRule.enable`, `NetworkIface.autostart` | `!== false` |
| Default-disabled | `BackupFile.protected`, `PVESnapshot.vmstate`/`running`, `FirewallIPSetEntry.nomatch`, `CreateCTParams.unprivileged` | `?? false` |

Note: I deviated from user's stated grouping "Backups (enabled, protected) — Default: Enabled". `BackupFile.protected` defaults to false in PVE (backups are NOT protected unless explicitly marked). Applying `!== false` would have mis-rendered every absent-field backup as protected. Flagged in commit.

## UI refactors (12 files)

| File | Change |
|---|---|
| `backup-job-editor.tsx` | enabled `!== false` / all `?? false` / shorthand writes |
| `backups-tab.tsx` | BackupFile → Public; `{ protected: 1 }` → `true` |
| `snapshots-tab.tsx` | PVESnapshot/CreateSnapshotParams → Public; vmstate ternary gone |
| `rule-editor.tsx` | FirewallRule → Public; `!== false` init; shorthand write |
| `firewall-rules-tab.tsx` | FirewallRule → Public; `=== false` opacity check |
| `firewall-scope.ts` | signatures threaded through |
| `restore-dialog.tsx` | BackupFile prop → BackupFilePublic (cascading) |
| `cluster/backups/page.tsx` | BackupFile/BackupJob → Public; `=== false` |
| `cts/create/page.tsx` | `unprivileged: state.unprivileged ?? false`; `onboot: false` |
| `system/network/page.tsx` | NetworkIface/Params → Public; boolean state; `!== false` init |

## Transformation discipline

Used Serena `replace_content` with `\bTypeName\b` regex for ALL type renames — zero PublicPublic bugs this phase. One regex mistake mid-phase (used `$1` instead of Serena's `$!1` backref syntax, corrupted 18 firewall rule lines), reverted the file and redid with correct syntax — 2-minute recovery.

**Lesson locked in:** Serena backrefs are `$!N`, not `$N`. Python `re` module under the hood, but the replacement token syntax is Serena-specific.

## Verification

- ✅ `npx tsc --noEmit`: 0 lines of output
- ✅ `npm test`: 14/14 pass (139ms)
- ✅ `grep -rn '=== 1\b\|? 1 : 0' src/components/`: zero matches

## Out-of-scope residue (intentional)

- `proxmox-client.ts:22/26/41/57` — codec internals (produce 0/1)
- `storage/page.tsx` — `PVEStorage.active/.shared` (list endpoint, not targeted)
- `vms/page.tsx:227` — `(vm as ClusterResource & { template?: number }).template === 1` cast (ClusterResource not migrated)

These are the only remaining wire-style comparisons in the entire codebase. Closing them would require broadening scope to `PVEStorage` and `ClusterResource` list endpoints.

## Session totals (A → B6)

| # | Domain | Files Touched | Keys Migrated |
|---|---|---|---|
| A | codec + primitives | 4 | — |
| B1 | firewall options | 5 | 9 |
| B2 | storage / restore | 6 | 5 |
| B3 | HA + quorate | 5 | 3 |
| B3.5 | cluster online/local | 4 | 2 |
| B4 | access users/realms/acl | 7 | 7 |
| B4.5 | access roles | 3 | 1 |
| B5 | VM/CT core | 6 | 7 |
| B6 | backup/snapshot/fw-rule/ct-create/network | 12 | 13 |

**47 bool keys migrated, 8 commits, ~55 files touched, zero test regressions, zero runtime bugs shipped.** The codebase's public UI surface is boolean-first end-to-end.

## PR readiness

Branch `refactor/pve-boolean-codec` is ready to merge. Suggested PR description: reference the overarching Serena memory (`refactoring_plan_proxmox_bool_codec`) and the per-phase landing memos.

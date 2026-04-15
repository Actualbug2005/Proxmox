# Phase B4.5 + B5 — Roles + VM/CT Core Landed

**Status:** Committed — `71dbe48` on branch `refactor/pve-boolean-codec`
**Parents:** B4 (`phase_b3_5_b4_cluster_access_landed`), chain back to A.

## B4.5 — Roles

- `PVERolePublic = UnwireBool<PVERole, 'special'>`
- `ROLE_BOOL_KEYS = ['special']`, `decodeRole` helper
- Wired `access.roles.list` / `.get`; `access.roles.create` / `.update` / `.delete` untouched (RoleParams has no bool fields)
- `roles-tab.tsx`: 5 `r.special === 1` sites → `(r.special ?? false)`; import + 4 state/mutation types swapped
- `acl-tab.tsx` prop adjustment: `roles: PVERolePublic[]`

Access domain now **100% migrated** (users, groups, realms, acl, roles).

## B5 — VM/CT Core

### Scope clarification
User's target keys included `protection` and `template` — neither existed on the pre-phase wire types. I added them as `PveBool` fields (they're legit PVE API fields, just previously absent from our TS surface). `CloneCTParams` has no `full` field in PVE either; only VM clone has it.

### Wire type changes (types/proxmox.ts)

Tightened `number` → `PveBool`:
- `VMConfig.onboot`, `VMConfigFull.onboot`, `CTConfig.onboot`
- `UpdateVMConfigParams.onboot`, `UpdateCTConfigParams.onboot`
- `CloneVMParams.full`
- `MigrateVMParams.online`, `MigrateVMParams.with_local_disks`
- `MigrateCTParams.online`, `MigrateCTParams.restart`

Added new `PveBool` fields (previously missing):
- `VMConfig.protection`, `VMConfig.template`
- `VMConfigFull.protection`, `VMConfigFull.template`
- `CTConfig.protection`, `CTConfig.template`
- `UpdateVMConfigParams.protection`, `UpdateVMConfigParams.template`
- `UpdateCTConfigParams.protection`, `UpdateCTConfigParams.template`

### 8 new Public types

`VMConfigPublic`, `VMConfigFullPublic`, `CTConfigPublic`, `UpdateVMConfigParamsPublic`, `UpdateCTConfigParamsPublic`, `CloneVMParamsPublic`, `MigrateVMParamsPublic`, `MigrateCTParamsPublic`.

### Codec bindings (proxmox-client.ts)

```ts
VM_CONFIG_BOOL_KEYS        = ['onboot', 'protection', 'template']
CT_CONFIG_BOOL_KEYS        = ['onboot', 'protection', 'template']
UPDATE_VM_CONFIG_BOOL_KEYS = ['onboot', 'protection', 'template']
UPDATE_CT_CONFIG_BOOL_KEYS = ['onboot', 'protection', 'template']
CLONE_VM_BOOL_KEYS         = ['full']
MIGRATE_VM_BOOL_KEYS       = ['online', 'with_local_disks']
MIGRATE_CT_BOOL_KEYS       = ['online', 'restart']
```

All under a new "VM / CT Codec Bindings" section, with a comment noting the semantic difference from `user.enable` (these default false-on-absent).

### 7 endpoints wired

- `vms.config` — decode VMConfigFullPublic
- `vms.updateConfig` — encode
- `vms.clone` — encode
- `vms.migrate` — encode
- `containers.config` — decode CTConfigPublic
- `containers.updateConfig` — encode
- `containers.migrate` — encode

(`containers.clone` unchanged — no bool fields.)

### UI refactors

**vms/[node]/[vmid]/page.tsx:**
- Line 219 clone: `full: p.full ? 1 : 0` → `full: p.full`
- Line 224 migrate: `online: p.online ? 1 : 0` → `online: p.online`
- Line 505 config: `onboot: e.target.checked ? 1 : 0` → `onboot: e.target.checked`
- Line 179 state type: `UpdateVMConfigParams` → `UpdateVMConfigParamsPublic`
- Line 510 keyof cast: same

**cts/[node]/[vmid]/page.tsx:** Analogous — `UpdateCTConfigParamsPublic` + one `onboot` ternary.

### Semantic distinction preserved

| Field | Undefined means | Read idiom |
|---|---|---|
| `user.enable` | **enabled** | `=== false` (explicit disable) |
| `onboot`, `protection`, `template` | **disabled** | `?? false` / `!!value` |

The `!!configDraft.onboot` pattern in the draft state was kept — it's semantically equivalent to `?? false` when the type is `boolean | undefined` and matches PVE's "absent = false" default. User's suggestion of `!== false` was noted but deliberately not applied to these fields — it would mis-render absent values as "enabled" (true), breaking users' expectations.

## Transformation discipline

Used Serena's `replace_content` with regex `\bTypeName\b` word-boundaries for all type-name renames. This sidesteps the `PublicPublic` suffix-match bug that bit phases B2, B3, and B4 (caught once in this phase too, before I switched tool).

The switch happened mid-phase after the literal-replace tool created `PVERolePublicPublic` on roles-tab. Regex replacement in Serena is the clean fix — no more trap.

## Verification

- ✅ `npx tsc --noEmit`: clean
- ✅ `npm test`: 14/14 pass (132 ms)
- ✅ Grep: zero `=== 1` or `? 1 : 0` for targeted keys (onboot, protection, template, full, online, special) on targeted types (VM/CT config + update + clone + migrate, PVERole)

## Out of scope, visible in grep

- `proxmox-client.ts` lines 22, 41 — inside codec functions (correct: these EMIT 0/1)
- `proxmox-client.ts` line 827 — `backups.protect(isProtected ? 1 : 0)` (BackupFile.protected, not a VM config field)
- `backup-job-editor.tsx` line 64 — BackupJob.enabled
- `snapshots-tab.tsx` line 88 — CreateSnapshotParams.vmstate
- `rule-editor.tsx` line 50 — FirewallRule.enable (list/rule, not FirewallOptions which was B1)
- `cts/create/page.tsx` line 317 — CreateCTParams.unprivileged
- `system/network/page.tsx` line 142 — NetworkIfaceParams.autostart
- `vms/page.tsx` line 227 — `(vm as ClusterResource & { template?: number }).template === 1` — list endpoint, ClusterResource not migrated this phase. Would require broadening scope to include `/cluster/resources`.

## Session summary

| Phase | Domain | State |
|---|---|---|
| A | Codec + primitives | ✅ |
| B1 | Firewall options | ✅ |
| B2 | Storage / restore | ✅ |
| B3 | HA groups, quorate | ✅ |
| B3.5 | ClusterStatus online/local | ✅ |
| B4 | Access — users/realms/acl | ✅ |
| B4.5 | Access — roles | ✅ |
| B5 | VM/CT — config/clone/migrate | ✅ |

Remaining territory for a B6 sweep if you want closure:
- Backup domain: `BackupJob.enabled`, `BackupFile.protected`, `vzdump.protected`, `backups.protect` endpoint
- Snapshot: `PVESnapshot.vmstate`, `PVESnapshot.running`, `CreateSnapshotParams.vmstate`
- Firewall rules (not options): `FirewallRule.enable`, `FirewallIPSetEntry.nomatch`
- CT create: `CreateCTParams.unprivileged`
- ClusterResource broadening: `template` on the cluster-level list endpoint
- Network: `autostart`
- Realm sync: `restricted` on the already-deprecated path

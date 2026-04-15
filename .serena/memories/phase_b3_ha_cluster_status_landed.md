# Phase B3 — HA / Cluster Status Migration Landed

**Status:** Committed — `e951cf4` on branch `refactor/pve-boolean-codec`
**Parent:** Phase B2 (`phase_b2_storage_restore_landed`)

## Impact pre-flight

`gitnexus impact HAGroup --direction upstream` again reported CRITICAL 80/44 — the known false positive (file-level resolution of importers of `types/proxmox.ts`). Real consumers of `HAGroup`, `HAStatus`, `ClusterStatus` (grep):

| Consumer | Types read | Touched? |
|---|---|---|
| `proxmox-client.ts` | all three as wire return types | ✅ encode/decode wired |
| `ha-group-editor.tsx` | HAGroup, HAGroupParams | ✅ full refactor |
| `cluster-status-panel.tsx` | ClusterStatus | ✅ quorate only |
| `ha-migrate-dialog.tsx` | ClusterStatus (via cluster.status query) | read-only; `s.online === 1` stays wire |
| `cluster/ha/page.tsx` | HAGroup (state types) | ✅ minimum type swap |

## Scope

3 boundary keys migrated (per user-revised scope):

| Type | Keys | Endpoints |
|---|---|---|
| `HAGroup` | `restricted`, `nofailback` | `ha.groups.list/get` (decode), `ha.groups.create/update` (encode) |
| `HAStatus` | `quorate` | `ha.status.current` (decode array) |
| `ClusterStatus` | `quorate` only — **NOT** `online` / `local` | `cluster.status` (decode array) |

4 new Public types exported from `types/proxmox.ts`:
`HAGroupPublic`, `HAGroupParamsPublic`, `HAStatusPublic`, `ClusterStatusPublic`.

## Codec bindings

Three per-type arrays under a shared section, matching Phase B1/B2 pattern:

```ts
const HA_GROUP_BOOL_KEYS       = ['restricted', 'nofailback'] as const satisfies readonly (keyof HAGroup)[];
const HA_STATUS_BOOL_KEYS      = ['quorate'] as const satisfies readonly (keyof HAStatus)[];
const CLUSTER_STATUS_BOOL_KEYS = ['quorate'] as const satisfies readonly (keyof ClusterStatus)[];
```

Wrappers: `decodeHAGroup`, `encodeHAGroupParams`, `decodeHAStatus` (row-wise), `decodeClusterStatus` (row-wise). The `decodeClusterStatus` docblock explicitly notes `online`/`local` remain PveBool for this phase.

`HAGroupParams` (wire) was removed from the client-side imports — all parameter methods now accept `HAGroupParamsPublic` and `encodeHAGroupParams` is responsible for the wire shape.

## Deliberate gap: online / local

Per user's 3-key scope, only `quorate` is unwired on `ClusterStatus`. Consumers retain wire-format reads:

- `cluster-status-panel.tsx` lines 18, 60, 63: `n.online === 1`
- `cluster-status-panel.tsx` line 66: `n.local === 1`
- `ha-migrate-dialog.tsx` line 20: `s.online === 1`

These still typecheck because `ClusterStatusPublic.online` / `.local` remain `PveBool | undefined`. The component's "status lights" (colored dots / orange "this node" badge) render correctly via these wire comparisons; only the top-level `quorate` badge is on the boolean side of the boundary.

Queue for a follow-up phase: broaden `CLUSTER_STATUS_BOOL_KEYS` to `['quorate', 'online', 'local']` and clean up the 5 remaining `=== 1` sites.

## UI changes

- `ha-group-editor.tsx` (16 lines changed): import, prop type, 2 state initializers (`?? false`), mutation signature, 2 submit-body shorthands.
- `cluster-status-panel.tsx` (1 line changed): `clusterEntry?.quorate ?? false`.
- `cluster/ha/page.tsx` (4 lines changed): `HAGroup` → `HAGroupPublic` in import + 2 state types + 1 mutation callback.

## Verification

- ✅ `npx tsc --noEmit`: clean
- ✅ `npm test`: 14/14 pass (169 ms)
- ✅ Grep: zero `? 1 : 0` and zero `(restricted|nofailback|quorate) === 1` in `src/components/ha/**`
- Status lights render correctly: `quorate ?? false` drives the shield-check/shield-alert badge; `n.online === 1` still drives the green/red node dots (PveBool still allows this comparison).

## Next

- **B4 (Access)** — realms-tab, acl-tab, users-tab. Dense: `default`, `secure`, `autocreate`, `propagate`, `enable`.
- **B5 (Snapshots / Backups)** — backup-job-editor (enabled), snapshots-tab (vmstate), `backups.protect` inline `? 1 : 0`.
- **Deferred** — broaden ClusterStatus to cover `online`/`local`; same for CT/VM config (`onboot`, `full`, `online` on clone/migrate/config).

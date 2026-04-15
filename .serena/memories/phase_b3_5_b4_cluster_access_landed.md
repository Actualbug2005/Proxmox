# Phase B3.5 + B4 — Cluster Sweep + Access Domain Landed

**Status:** Committed — `9250431` on branch `refactor/pve-boolean-codec`
**Parents:** B3 (`phase_b3_ha_cluster_status_landed`), B2 (storage), B1 (firewall), A (codec)

## B3.5 — Cluster sweep

Broadened `CLUSTER_STATUS_BOOL_KEYS` from `['quorate']` to `['quorate', 'online', 'local']`. `ClusterStatusPublic` now unwires all three via the same `UnwireBool<ClusterStatus, 'quorate' | 'online' | 'local'>` mapped type. Removed the "online/local stay wire" caveat docblock on `decodeClusterStatus` — scope is now complete for the cluster status shape.

UI refactors (5 sites total):
- `cluster-status-panel.tsx` lines 18, 60, 63: `n.online === 1` → `n.online ?? false`
- `cluster-status-panel.tsx` line 66: `n.local === 1` → `(n.local ?? false)` (parenthesised — inside JSX ternary)
- `ha-migrate-dialog.tsx` line 20: `s.online === 1` → `(s.online ?? false)` (parenthesised — inside filter predicate chained with `&&`)

## B4 — Access domain

Six new Public types in `types/proxmox.ts`:
| Wire | Public | Unwired keys |
|---|---|---|
| `PVEUser` | `PVEUserPublic` | `enable` |
| `UserParams` | `UserParamsPublic` | `enable` |
| `PVERealm` | `PVERealmPublic` | `default`, `secure`, `autocreate` |
| `RealmParams` | `RealmParamsPublic` | same 3 |
| `PVEACL` | `PVEACLPublic` | `propagate` |
| `ACLParams` | `ACLParamsPublic` | `propagate`, `delete` |

Four codec key arrays in the "Access Codec Bindings" section:
```ts
const USER_BOOL_KEYS        = ['enable']
const REALM_BOOL_KEYS       = ['default', 'secure', 'autocreate']
const ACL_BOOL_KEYS         = ['propagate']             // read
const ACL_PARAMS_BOOL_KEYS  = ['propagate', 'delete']   // write — different key set
```

The split between `ACL_BOOL_KEYS` (for `PVEACL` response shape) and `ACL_PARAMS_BOOL_KEYS` (for `ACLParams` write shape) is intentional: `delete` is a write-only flag (instruction to PVE), not a field on responses.

Wrappers: `decodeUser`, `encodeUserParams`, `decodeRealm`, `encodeRealmParams`, `decodeAcl` (row-wise), `encodeAclParams`.

Wired endpoints:
- `access.users` — list/get decode, create/update encode
- `access.realms` — list/get decode, create/update encode
- `access.acl` — list decode, update encode

## UI refactors — preserve PVE `undefined = enabled` semantic

**users-tab.tsx** — most careful rewrite of the session. Proxmox returns `enable === undefined` when the field wasn't set in user config; that means "enabled" (PVE's default). Two consumer patterns at stake:

- Display (line 86): `u.enable === 0 ? disabled : enabled` → `u.enable === false ? disabled : enabled`
  - Semantic preserved: only **explicit** false renders as disabled. `undefined` renders as enabled.
  - Naive `!u.enable` would mis-render `undefined` as disabled.
- Init (line 125): `initial?.enable !== 0` → `initial?.enable !== false`
  - Same semantic. Default state on "new user" form: checkbox enabled.

Write-site: `enable: enable ? 1 : 0` → `enable` (property shorthand, boolean passes through codec).

**realms-tab.tsx** (11 edits) — straight pattern: 4 `=== 1` reads → `?? false`, 3 `? 1 : 0` writes → shorthand. 7 type references swapped to `*Public`.

**acl-tab.tsx** (included despite user's named UI scope being just users/realms) — same reason as B2's `map-storage-dialog`: `propagate` is a boundary key and this is its only consumer. 1 read → `?? false`, 1 write → shorthand, 1 explicit action flag `delete: 1` → `delete: true`.

## Out of scope, deliberately

**`roles-tab.tsx`** — user's explicit endpoint list for B4 was `/access/users`, `/access/realms`, `/access/acl`. Roles endpoint NOT included. Consequence: `PVERole.special` stays wire PveBool, `roles-tab.tsx` retains 4 `r.special === 1` sites that still typecheck. No `PVERolePublic` / `ROLE_BOOL_KEYS` declared — zero dead code.

Queue: roles migration (tiny — 4 sites, 1 endpoint, 1 type) whenever you want to close the access domain fully.

## Verification

- ✅ `npx tsc --noEmit`: clean (0 lines of output)
- ✅ `npm test`: 14/14 pass (163 ms)
- ✅ Grep in `src/components/access/**`: only `length === 0` array checks and out-of-scope `r.special === 1` remain
- ✅ Grep for `(online|local|quorate) === 1` project-wide: zero matches — cluster sweep complete
- ✅ Users-tab enable toggle semantic verified via `=== false` / `!== false` round-trip

## LSP stale-diagnostic pattern

Third phase in a row where `replace_all` created `PublicPublic` double-suffixes because the first replace already planted `Public`. Memo to self: when doing a type rename via `replace_all`, do the import line edit in isolation *first* (with a narrower `old_string` capturing the `, ` separators), then do the body replace_all on the bare name. Or just skip `replace_all` for type-name migrations and use targeted Edits instead.

## Session-wide status

5 of 6 planned domain phases complete:
- ✅ A — codec + primitives
- ✅ B1 — firewall options
- ✅ B2 — storage / restore
- ✅ B3 — HA groups + quorate
- ✅ B3.5 — cluster sweep (online, local)
- ✅ B4 — access (users, realms, acl)
- ⏳ Remaining sweeps: `r.special` (roles), VM/CT clone/migrate/config (`full`, `online`, `onboot`), snapshots/backups (`vmstate`, `enabled`, `protect`)

No test regressions; zero consumer breakage since A committed.

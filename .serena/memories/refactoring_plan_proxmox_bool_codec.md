# Refactoring Plan — Proxmox `0 | 1` Boolean Codec

## Problem

Proxmox REST API uses integer `0 | 1` on the wire for boolean flags (ExtJS heritage). The Nexus codebase mirrors that 1:1 into TypeScript, bleeding the wire convention into UI state and JSX:

- **45** inline `0 | 1` union-literal fields in [nexus/src/types/proxmox.ts](nexus/src/types/proxmox.ts)
- **32** `flag ? 1 : 0` write-side ternaries across 16 files
- **41** `=== 1` / `== 1` read-side equality checks across 18 files
- **No** centralized conversion utility (`boolToInt`, `toPveBool`, etc. grep returns 0)
- **30** files import `types/proxmox.ts`

Consumers written like:
```tsx
<input type="checkbox"
  checked={draft.macfilter === 1}
  onChange={(e) => set('macfilter', e.target.checked ? 1 : 0)} />
```

Hotspots (densest refactor surface): `firewall-options-tab.tsx` (9 ternaries), `restore-dialog.tsx`, `ha-group-editor.tsx`, `realms-tab.tsx`, `cts/create/page.tsx`, VM/CT detail pages.

## Goal

Frontend consumers work with native `boolean`. `0 | 1` stays at the HTTP I/O boundary only. Proxmox API contract unchanged.

## Design

### 1. Codec utilities — `nexus/src/lib/proxmox-bool.ts` (new)

```ts
export type PveBool = 0 | 1;
export const toPveBool = (v: boolean | undefined): PveBool | undefined =>
  v === undefined ? undefined : v ? 1 : 0;
export const fromPveBool = (v: PveBool | boolean | undefined): boolean =>
  v === 1 || v === true;
export function encodeBoolFields<T extends object>(
  obj: T, keys: readonly (keyof T)[]
): T { /* shallow copy with ternary per key */ }
```

Unit-tested on `undefined`, `null`, both truthy/falsy branches, and round-trip.

### 2. Type split in `nexus/src/types/proxmox.ts`

Two layers:
- **Wire types (internal)**: keep `0 | 1`, rename to `*WireParams` / `*WireResponse`. Not exported from the module's public surface.
- **Public types (consumers see these)**: re-expose as `boolean`. Generated via mapped type:
  ```ts
  type UnwireBool<T> = { [K in keyof T]: T[K] extends 0|1|undefined ? boolean|undefined : T[K] };
  export type RealmParams = UnwireBool<RealmWireParams>;
  ```

### 3. Boundary enforcement in `nexus/src/lib/proxmox-client.ts`

- **Outbound**: each request method that takes a `*Params` calls `encodeBoolFields(params, BOOL_KEYS)` before `fetch`.
- **Inbound**: responses that carry `0 | 1` fields pass through a response decoder. Cheapest path: a generic `decodeBools<T>(resp, keys)` called inside the method (keeps tree-shakeable, no runtime schema layer).

### 4. Migration sequence (risk-ordered, ship each phase independently)

| Phase | Scope | Files | Risk | Verify |
|---|---|---|---|---|
| A | Codec utility + unit tests | 2 new | none | `gitnexus_detect_changes` clean, tests green |
| B1 | `firewall-options-tab` + firewall types | 1 type block, 1 component | med — densest | manual click-through of firewall screen |
| B2 | Storage: restore-dialog, map-storage-dialog | 2 types, 2 components | low | restore flow, map storage flow |
| B3 | HA: group-editor, migrate-dialog | 2 components | low | HA group create/edit |
| B4 | Access: realms, acl, users | 3 components | med — multi-flag | login + permissions audit |
| B5 | VM/CT: create wizards + detail pages | 4 components | high — user-visible config | VM clone, CT create, onboot toggle |
| B6 | Snapshots, backups, network | 3 components | low | snapshot w/ vmstate, backup job edit |
| C | Remove `0 | 1` from exported types (only wire remains) | types/proxmox.ts | low (build breaks on miss) | `tsc --noEmit` must pass |

### 5. Pre-flight for each phase

Before editing any symbol, run:
```
gitnexus impact --target <Symbol> --direction upstream
```
Flag HIGH/CRITICAL. After each phase: `gitnexus detect_changes` to confirm scope. After phase C: `gitnexus analyze --embeddings --force` to re-index.

### 6. Non-goals

- Don't restructure response types into camelCase or other shape changes — keep diff minimal.
- Don't introduce a runtime schema validator (zod/io-ts) in this refactor. That's a separate decision.
- Don't touch `proxmox-client.ts` low-level fetch layer — only the parameter encoding helpers.

## Consumer file inventory

Writes (ternary): proxmox-client.ts, backup-job-editor.tsx, rule-editor.tsx, firewall-options-tab.tsx, restore-dialog.tsx, ha-group-editor.tsx, map-storage-dialog.tsx, smart-details.tsx, cts/create/page.tsx, vms/[node]/[vmid]/page.tsx, snapshots-tab.tsx, realms-tab.tsx, cts/[node]/[vmid]/page.tsx, acl-tab.tsx, users-tab.tsx, network/page.tsx.

Reads (`=== 1`): additionally ha-migrate-dialog.tsx, cluster-status-panel.tsx, backups-tab.tsx, node-card.tsx, roles-tab.tsx, vms/page.tsx, nodes/page.tsx, packages/page.tsx, storage/page.tsx.

## Starting point

Begin with Phase A in isolation on a new branch. Do not bundle Phase A + B1 — keep the codec commit atomic so a revert is trivial.

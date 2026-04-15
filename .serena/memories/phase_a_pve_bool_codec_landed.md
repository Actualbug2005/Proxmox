# Phase A — PveBool Codec Landed

**Status:** Committed — `4bb82e2` on branch `refactor/pve-boolean-codec`
**Parent of plan:** `refactoring_plan_proxmox_bool_codec` (Serena memory)
**Scope constraint honored:** Zero consumer React components touched.

## What landed

### [nexus/src/types/proxmox.ts](nexus/src/types/proxmox.ts)
- `PveBool = 0 | 1` type alias added at the top of the module with explanatory header.
- `WireBool<T, K>` mapped type — flips specified keys from `boolean` → `PveBool`, preserving `undefined` unions.
- `UnwireBool<T, K>` mapped type — inverse.
- 45 inline `0 | 1` occurrences aliased to `PveBool` via replace_all (pure type-level rename, structurally identical).

### [nexus/src/lib/proxmox-client.ts](nexus/src/lib/proxmox-client.ts)
- `toPveBool(boolean | undefined)` — overloaded signature: `undefined` passes through, else `1 | 0`.
- `fromPveBool` — accepts `PveBool | boolean | null | undefined`, returns `boolean`. Defensive against wire variants Proxmox emits.
- `encodeBoolFields<T, K>(obj, keys)` — shallow copy with listed keys flipped to `PveBool`. Non-mutating.
- `decodeBoolFields<T, K>(obj, keys)` — inverse. Non-mutating.
- Codec exported but **not wired into any request method** — Phase B will thread it domain-by-domain.

### [nexus/src/lib/proxmox-client.test.ts](nexus/src/lib/proxmox-client.test.ts) (new)
- 14 test cases across 6 suites, using `node:test` + `tsx` loader.
- Covers: truthy/falsy/undefined encode, decode with null coalescing, idempotence on already-decoded booleans, mutation guarantees, empty-keys, full round-trip.

### [nexus/package.json](nexus/package.json)
- Added `"test": "node --import tsx --test 'src/**/*.test.ts'"` script. No new deps — `tsx` already devDep'd.

## Verification

- ✅ `npm test`: 14 pass, 0 fail, 0 skip (161ms)
- ✅ `npx tsc --noEmit`: clean
- ✅ `git status`: only expected files staged; 20 consumer components untouched
- ✅ PostToolUse hook triggered `gitnexus analyze --embeddings` to refresh the index at new HEAD

## Next

Phase B1: migrate `firewall-options-tab.tsx` + firewall request types. Convert the 9 ternary write sites and 9 equality reads to boolean-first; thread `encodeBoolFields` through the firewall request builders in `proxmox-client.ts`.

Precondition for Phase B1: run `gitnexus impact --target FirewallOptions --direction upstream` and ensure HIGH/CRITICAL flags are reviewed.

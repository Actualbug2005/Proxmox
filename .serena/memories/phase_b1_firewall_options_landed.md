# Phase B1 — Firewall Options Migration Landed

**Status:** Committed — `9c3ec16` on branch `refactor/pve-boolean-codec`
**Parent:** Phase A (`phase_a_pve_bool_codec_landed`)

## Impact analysis

`gitnexus impact FirewallOptions --direction upstream` reported CRITICAL / 80 impacted symbols / 44 direct — **false positive**. The tool resolved `FirewallOptions` at *file* granularity and returned every importer of `types/proxmox.ts`. Symbol-level impact (grep for `FirewallOptions` uses only):

- `proxmox-client.ts` — 4 endpoint pairs (cluster/node/vm/ct × get/update)
- `firewall-scope.ts` — `getOptions` / `updateOptions` wrappers
- `firewall-options-tab.tsx` — the UI (target)
- 3 page.tsx files — forward the tab as a child, don't see the type

## Binding pattern (reusable for Phase B2+)

In `proxmox-client.ts`, beside the codec:

```ts
const FIREWALL_OPTIONS_BOOL_KEYS = [
  'enable', 'ebtables', 'nosmurfs', 'tcpflags', 'macfilter',
  'dhcp', 'ipfilter', 'ndp', 'radv',
] as const satisfies readonly (keyof FirewallOptions)[];

const decodeFirewallOptions = (raw: FirewallOptions): FirewallOptionsPublic =>
  decodeBoolFields(raw, FIREWALL_OPTIONS_BOOL_KEYS) as FirewallOptionsPublic;
const encodeFirewallOptions = (opts: Partial<FirewallOptionsPublic>): Record<string, unknown> =>
  encodeBoolFields(opts, FIREWALL_OPTIONS_BOOL_KEYS) as Record<string, unknown>;
```

The `satisfies readonly (keyof FirewallOptions)[]` compile-checks the key list against the interface — refactor-safe. Each GET wraps `decodeFirewallOptions(await ...)`; each PUT substitutes `opts as Record<string, unknown>` with `encodeFirewallOptions(opts)`.

Replicate this triplet (const keys + decode + encode) per domain in B2–B6.

## Important pivot during implementation

Phase A's `UnwireBool`/`WireBool` used `Omit<T, K> & { [P in K]?: ... }`. This broke on `FirewallOptions` because it carries `[key: string]: unknown` index signature — `Omit` preserved the signature, and specific string-keyed fields (`policy_in`, `log_level_in`) fell through to `unknown`, making `<select value={draft.policy_in ?? 'DROP'}>` reject with "Type '{}' is not assignable to string".

**Fix:** rewrote as homomorphic mapped types:

```ts
export type UnwireBool<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? boolean | undefined : T[P];
};
```

Homomorphic `[P in keyof T]` preserves optional markers, readonly-ness, and index signatures. Only keys in K are retyped. Zero behavior change for Phase A's alias-only usage, but correct semantics for real consumers.

## Verification
- `npx tsc --noEmit`: clean
- `npm test`: 14/14 pass (unchanged — codec tests still green)
- `rule-editor.tsx` still carries `enable ? 1 : 0` for FirewallRule — different type, out of B1 scope (queue for B1.5 or roll into B2)

## Next
Phase B2: storage domain. `restore-dialog.tsx` (3 writes) + `map-storage-dialog.tsx` (1 write) + `smart-details.tsx` (2 writes, note inverted `? 0 : 1`). Touches `RestoreParams`, `StorageCreatePayload`.

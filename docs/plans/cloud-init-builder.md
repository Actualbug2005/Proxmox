# Plan: Cloud-Init Builder (Tier 5 — Automation, Phase D)

**Goal:** On a template VM's detail page, click **Clone** → a wizard collects target-node selection, the usual clone params (newid, name, full), and a cloud-init config (hostname, user + password, SSH keys, per-NIC network, DNS). On confirm: clone the VM, wait for the PVE task to finish, then patch the new VM's config with the cloud-init fields. No race with PVE's VM lock.

**Strategy:** Every PVE primitive already exists — `api.vms.clone`, `api.vms.updateConfig`, plus the full cloud-init field set in the `VMConfigFull` type. What's missing: those fields in `UpdateVMConfigParams`, a small SSH-key normalizer, a generic "await UPID" helper, and the UI assembly.

---

## Phase 0 — Documentation Discovery (COMPLETE)

### Allowed APIs (use these, do not invent alternatives)

| Capability | Symbol / Path | Use for |
|---|---|---|
| Clone | `api.vms.clone(node, vmid, {newid, name?, target?, full?, pool?})` → `Promise<UPID>` in `proxmox-client.ts:571-572` | Start the clone |
| Update config | `api.vms.updateConfig(node, vmid, params)` → `Promise<null>` in `proxmox-client.ts:552-556` | Apply cloud-init fields after clone completes |
| Task status | `GET /nodes/{node}/tasks/{upid}/status` via the proxy | Await clone UPID before patching config |
| Modal shell | `fixed inset-0 ... studio-card p-6 max-w-2xl` | Wizard shell (matches migration wizard) |
| Step indicator | Pattern from `migrate-wizard.tsx:StepIndicator` | Copy — same three-circle layout |
| Template marker | `ClusterResourcePublic.template: boolean` | Clone button is only offered on templates; others stay on the regular Clone flow |

### Anti-patterns (do NOT do these)

- **Do NOT** call `updateConfig` in `onSuccess` of the clone mutation. The clone UPID is async and the VM is locked until the task finishes — the config update will 403 with "VM is locked". **Always wait for the task** before patching.
- **Do NOT** auto-import the user's local SSH keys (`~/.ssh/...`). The builder collects pasted keys only — too easy to leak the wrong key otherwise.
- **Do NOT** hash the password client-side. PVE accepts `cipassword` plaintext and hashes server-side (`sha256crypt`/`sha512crypt`). Trying to pre-hash produces a double-hash on the stored side.
- **Do NOT** pre-fill the username based on the template's guessed OS ("ubuntu" vs "debian"). Too fragile. Let the user type it.
- **Do NOT** change the existing single-VM `CloneDialog` on non-template VMs. Template VMs get the new wizard; regular VMs keep the minimal dialog (less friction for the "quick copy" case).
- **Do NOT** use `react-hook-form` or `zod`. Vanilla `useState` + field-level regex matches every other editor in the repo.
- **Do NOT** add a `ciuser` regex stricter than PVE's own. The value is passed as-is to cloud-init — PVE rejects garbage anyway.

### Key facts from discovery

- `VMConfigFull` already has `ciuser`/`cipassword`/`sshkeys`/`ipconfig0`/`ipconfig1`/`searchdomain`/`nameserver` (proxmox.ts:560-567). 
- `UpdateVMConfigParams` does **not** yet include any cloud-init field — Phase 1 adds them.
- `encodeUpdateVMConfig` only translates bool fields (`onboot`, `protection`, `template`). It leaves string fields alone, so cloud-init fields pass through once added to the type.
- PVE accepts `sshkeys` as plain text with literal newlines; the Nexus proxy serializes via JSON, so we don't need `%0A` encoding — just a trim + normalize CRLF → LF + drop comment-only lines helper.
- Clone → config update race is real. The existing bulk-lifecycle `pollTask` in `run-bulk-op.ts:pollTask` is the shape to copy (GET `/nodes/{node}/tasks/{upid}/status`, look at `status === 'stopped'` + `exitstatus === 'OK'`).
- Template VMs carry `template === true` in `ClusterResourcePublic` and render a "template" Badge in the VMs list.

---

## Phase 1 — Extend `UpdateVMConfigParams` + SSH-key normalizer

**What to implement**

1. **Extend `UpdateVMConfigParams`** in `nexus/src/types/proxmox.ts`:
   ```ts
   // Cloud-init — applied post-clone by the builder wizard. All optional.
   ciuser?: string;
   cipassword?: string;
   sshkeys?: string;            // Literal newlines between keys; wrapper URL-encodes.
   ipconfig0?: string;          // e.g. "ip=dhcp", "ip=10.0.0.5/24,gw=10.0.0.1"
   ipconfig1?: string;
   ipconfig2?: string;
   ipconfig3?: string;
   searchdomain?: string;
   nameserver?: string;
   citype?: 'nocloud' | 'configdrive2';
   cicustom?: string;           // snippets:... path, advanced user-data
   ```
   Note the existing `UpdateVMConfigParamsPublic = UnwireBool<UpdateVMConfigParams, ...>` — no bool fields added, so no change there.

2. **Extend `encodeUpdateVMConfig`** in `proxmox-client.ts`. PVE requires `sshkeys` URL-encoded on the wire (newlines → `%0A`). Add the encoding there so callers can pass plain multi-line strings.

3. **New helper** `nexus/src/lib/cloud-init.ts` — a tiny module exporting:
   ```ts
   /** Normalize pasted-in keys: CRLF → LF, trim, drop comment-only + empty lines,
    *  validate each line against a known SSH algorithm prefix. Returns the
    *  cleaned multi-line string OR a list of rejection reasons. */
   export function normalizeSshKeys(raw: string):
     | { ok: true; value: string; count: number }
     | { ok: false; errors: string[] };

   /** Build one ipconfigN string from form fields. */
   export interface NicConfigInput {
     ipv4Mode: 'dhcp' | 'static' | 'none';
     ipv4Cidr?: string;
     ipv4Gw?: string;
     ipv6Mode: 'dhcp' | 'auto' | 'static' | 'none';
     ipv6Cidr?: string;
     ipv6Gw?: string;
   }
   export function buildIpconfig(input: NicConfigInput): string;
   ```

4. **Tests** at `nexus/src/lib/cloud-init.test.ts`:
   - `normalizeSshKeys` accepts valid ssh-ed25519 / ssh-rsa lines
   - strips CRLF / trailing whitespace / blank lines / `# comment` lines
   - rejects a line starting with "not an ssh key" with a clear error
   - `buildIpconfig` produces `ip=dhcp`, `ip=10.0.0.5/24,gw=10.0.0.1`, `ip=dhcp,ip6=fd00::5/64,gw6=fd00::1` for the documented combinations
   - none-mode on both v4 and v6 returns an empty string (caller skips the field)

**Documentation references**

- Type location: `types/proxmox.ts:692-709` (current `UpdateVMConfigParams`)
- Encode helper: `proxmox-client.ts:211-214` (`encodeUpdateVMConfig`)
- Tests pattern: `cron-match.test.ts` is the closest cousin — pure function, node:test, no framework

**Verification**

- `npx tsc --noEmit` clean
- `npm test` — new cases for both helpers pass
- `encodeUpdateVMConfig({ sshkeys: "ssh-ed25519 AAA\nssh-rsa BBB" })` returns something with `%0A` between the keys

**Anti-pattern guards**

- Do NOT expose `normalizeSshKeys` failures as exceptions. Return `{ ok: false, errors }` so the form can render them inline.
- Do NOT normalize usernames / hostnames here. That's form-level concern; keep this module PVE-param-aware only.

---

## Phase 2 — `useTaskCompletion` hook

**What to implement**

1. **New hook** `nexus/src/hooks/use-task-completion.ts`:
   ```ts
   export interface TaskCompletion {
     terminal: boolean;
     ok: boolean;
     exitstatus?: string;
     error?: Error;
   }
   export function useTaskCompletion(
     node: string | null,
     upid: string | null,
     opts?: { pollIntervalMs?: number; maxWaitMs?: number },
   ): { state: 'idle' | 'waiting' | 'done' | 'timeout' | 'error'; result?: TaskCompletion };
   ```
   Uses `useQuery` on `['task', node, upid, 'status']` with `refetchInterval` = 2s while non-terminal, `false` after. Stops cleanly when `upid === null`.

2. **Task status endpoint** already exists via `api.nodes.tasks(node)` returning a list, but we want a single UPID. Add `api.nodes.taskStatus(node, upid)` in `proxmox-client.ts` → `GET nodes/{node}/tasks/{upid}/status`. Typed against a new `PVETaskStatus` interface in `types/proxmox.ts`.

3. **Tests** — the hook is React-only so we skip unit tests. Integration smoke comes from the wizard.

**Documentation references**

- Same polling shape: `run-bulk-op.ts:pollTask` (server-side) — rewrite for client-side fetch through the proxy
- Query-key convention: `use-cluster.ts:POLL_INTERVALS` for cadence constants (2s is appropriate; add a key if needed)

**Verification**

- `npx tsc --noEmit` clean
- Manual: create a VM clone in dev, wire the hook in the browser console, observe state transitions `idle → waiting → done`

**Anti-pattern guards**

- Do NOT poll after the caller disables the hook. `enabled: !!upid && state !== 'done'`.
- Do NOT throw on network error. Put the error in `result.error` and let the caller render it.

---

## Phase 3 — `CloudInitForm` component (pure collection, no side effects)

**What to implement**

1. **New component** `nexus/src/components/cloud-init/cloud-init-form.tsx`:
   - Shape: `value: CloudInitFormState; onChange: (next) => void`. All state is lifted — parent (wizard) owns it.
   - Fields:
     - Hostname (`input`) — regex `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, inline "invalid hostname" when non-empty + non-matching
     - Username (`input`) — optional, regex `^[a-z_][a-z0-9_-]{0,31}$`
     - Password (`input type="password"` with reveal toggle) — no client-side validation beyond min length suggestion
     - SSH keys (`textarea`) — on blur, run `normalizeSshKeys`; show count + inline errors
     - NIC 0 section: IPv4 mode radio (DHCP / Static / None), static IP+gw fields when static; IPv6 mode radio (Auto / DHCP / Static / None), static fields when static. Derived preview: the generated `ipconfig0` string shown in a faded mono line below.
     - Nameservers (`input`) — space-separated
     - Search domain (`input`) — optional
   - Uses vanilla `useState` via the lifted `value`. No `react-hook-form`.

2. **Type** `CloudInitFormState`:
   ```ts
   interface CloudInitFormState {
     hostname: string;
     username: string;
     password: string;
     sshKeysRaw: string;
     nic0: NicConfigInput;
     nameserver: string;
     searchdomain: string;
   }
   ```

3. **Helper** `cloudInitStateToUpdateParams(state): Partial<UpdateVMConfigParamsPublic>` exported from the same file. Empty-string fields are dropped (don't send `ciuser: ""` to PVE, which would clear it). `normalizeSshKeys` is called here; on failure, the helper returns `null` (caller shows errors and blocks submit).

**Documentation references**

- Form conventions: `schedule-job-editor.tsx` and `backup-job-editor.tsx` (vanilla `useState`, inline inputs)
- Password field with reveal: check `app/login/page.tsx` if one exists — otherwise just `type="password"` + a button toggling to `type="text"`

**Verification**

- `npx tsc --noEmit` clean; lint clean
- Rendered alone in the wizard: typing in every field updates the state without side effects

**Anti-pattern guards**

- Do NOT submit anything from this component. It's purely a form.
- Do NOT debounce hostname validation — inline regex on every keystroke is fine for a 63-char field.

---

## Phase 4 — Clone-with-cloud-init wizard + integration

**What to implement**

1. **New component** `nexus/src/components/clone/clone-wizard.tsx`:
   - Shell: same `fixed inset-0 ... studio-card p-6 max-w-2xl` as migrate-wizard.
   - Three steps: **Clone params → Cloud-Init → Review & create**.
     - Step 1: `newid` (pre-filled from `api.cluster.nextid()`), `name` (pre-filled `<source>-clone`), `target` node (select; default: same node), `full` (checkbox). Mirrors the existing CloneDialog fields + adds `target`.
     - Step 2: `<CloudInitForm>` with a lifted state. A small note at the top: "Applied after clone completes — may require a VM restart to take effect."
     - Step 3: Summary of step 1 + step 2 (masking password). "Create" button.
   - Clone-with-wait flow on submit:
     1. `mutate()` → `api.vms.clone(...)` returns UPID
     2. `useTaskCompletion(sourceNode, upid)` transitions `waiting`; wizard shows a progress step
     3. On `done + ok`, call `api.vms.updateConfig(targetNode ?? sourceNode, newid, cloudInitParams)`
     4. Final toast; navigate to the new VM's detail page
     5. On any failure: inline error + "Open new VM" link so the user can manually fix

2. **Integration on the VMs list** (`nexus/src/app/(app)/dashboard/vms/page.tsx`):
   - Only template VMs get the new wizard path; regular VMs keep their existing Clone affordance (unchanged).
   - Template rows expose a "Clone with Cloud-Init" button (new) alongside whatever currently exists. Reuse the existing "template" Badge position.

3. **Integration on template VM detail page** (`dashboard/vms/[node]/[vmid]/page.tsx`):
   - When `config.template === true`, replace the existing `CloneDialog` trigger with the new `CloneWizard`. Non-template VMs keep the plain dialog.

**Documentation references**

- Existing CloneDialog for reference: `dashboard/vms/[node]/[vmid]/page.tsx:46-106`
- Wizard step pattern: `components/migrate/migrate-wizard.tsx` (numbered circles + connector lines + Back/Next)
- Nextid fetch: `api.cluster.nextid()` is already used at `dashboard/vms/[node]/[vmid]/page.tsx:58`
- Post-success navigation pattern: `migrate-wizard.tsx` `onSuccess` callback

**Verification**

- `npx tsc --noEmit` clean
- Dev: clone a template VM with cloud-init: hostname `web01`, user `ubuntu`, one SSH key, `ip=dhcp`. After clone:
  - `qm config <newid>` on the host shows `ciuser: ubuntu`, `sshkeys: ...%0A...`, `ipconfig0: ip=dhcp`
  - VM list shows the new VM, non-template
  - Starting the VM and connecting via SSH works with the provided key

**Anti-pattern guards**

- Do NOT skip the wait. The race WILL bite in prod.
- Do NOT let a failed config update block the user from seeing that the clone succeeded. Present the partial success clearly.
- Do NOT send `{ ciuser: "", sshkeys: "" }` on empty inputs — `cloudInitStateToUpdateParams` drops empty keys.

---

## Phase 5 — Verification + anti-pattern greps

**Checks**

1. **Unit tests** pass: Phase 1's cloud-init helpers.
2. **Type + lint gate**: `npx tsc --noEmit` clean; `npx next lint` clean on new files.
3. **Full test suite**: `npm test` — all existing + new tests pass.
4. **Anti-pattern greps**
   - `rg "react-hook-form|from 'zod'" nexus/src/components/cloud-init nexus/src/components/clone` → zero
   - `rg "onMutate" nexus/src/hooks/use-task-completion.ts` → zero
   - `rg "sha256crypt|bcrypt" nexus/src/components/cloud-init` → zero (no client-side hashing)
   - `rg "updateConfig.*cloud" nexus/src/components/clone/clone-wizard.tsx` → expect ≥1 match (the intended call site)
   - `rg "cloud-init|cloudInit|use-task-completion" nexus/server.ts` → zero (no strip-types tarball regression)
5. **Import-graph sanity**: cloud-init helpers and the wizard must live entirely inside the Next.js-bundled graph. None reachable from `server.ts`.
6. **Manual smoke matrix**
   | Case | Expected |
   |---|---|
   | Clone template with full cloud-init fields | New VM has all fields set in `qm config` |
   | Clone with empty SSH keys | `sshkeys` absent from config |
   | Clone with only hostname | Only `ciuser`/`sshkeys`/`ipconfig0` etc. that are non-empty are sent |
   | Clone across nodes (`target` set) | Clone succeeds; config update targets the new node |
   | PVE task fails | Wizard shows the failure; no orphan config update call |
   | SSH key with a comment line | Stripped; rest of keys accepted |
   | Password with reveal toggle | Plaintext only visible while toggle is on |

**Exit criteria**

- Manual smoke matrix passes on a real Proxmox host
- No regression on the existing quick-clone dialog for non-template VMs
- `HAMigrateDialog`, migration wizard, and scheduler all still work

---

## Commit boundaries

- Phase 1 → one commit (types + encode + helpers + tests)
- Phase 2 → one commit (task-status API + hook)
- Phase 3 → one commit (CloudInitForm + state helpers)
- Phase 4 → one commit (CloneWizard + integration on template VM detail + VMs list)
- Phase 5 → verification-only commit with smoke-matrix notes

All new files under `src/lib/`, `src/hooks/`, `src/components/cloud-init/`, `src/components/clone/`. Tarball already ships `src/lib/**` per [d58b721](d58b721). UI components ride the standard `.next` bundle.

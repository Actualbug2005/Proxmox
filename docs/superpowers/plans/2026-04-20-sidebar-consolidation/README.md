# Sidebar Consolidation — Plan Index

> **Source spec:** [SIDEBAR-CONSOLIDATION.md](../../../../SIDEBAR-CONSOLIDATION.md) at the repo root.

The consolidation ships as **six independent plans**. Each is executable on its own, and each leaves the app in a working, testable state (old routes either stay live or redirect to the new home). The keystone sidebar trim (Plan F) is the last commit — after it lands, the UX change is visible to users.

## Plans

| # | Plan | Scope | Sidebar Δ |
|---|------|-------|-----------|
| A | [plan-a-automation.md](./plan-a-automation.md) | Merge `/scripts` + `/dashboard/schedules` + `/dashboard/chains` into `/dashboard/automation` with tabs | −2 |
| B | [plan-b-resources.md](./plan-b-resources.md) | Add type filter to Resources; demote Pools to modal; drop Nodes/VMs/CTs sidebar entries | −4 |
| C | [plan-c-cluster.md](./plan-c-cluster.md) | Merge HA + DRS + Backups + Firewall into `/dashboard/cluster` with tabs | −3 |
| D | [plan-d-node-settings.md](./plan-d-node-settings.md) | Merge `/system/{power,network,logs,packages,certificates}` into tabbed `/dashboard/system` | −5 |
| E | [plan-e-service-account.md](./plan-e-service-account.md) | Move Service Account into Users & ACL as a 6th tab | −1 |
| F | [plan-f-sidebar-trim.md](./plan-f-sidebar-trim.md) | Update `sidebar.tsx` + its test to the 13-item layout | — |

## Execution Order

Plans **A–E are independent and can ship in any order** (or in parallel on separate branches). Plan **F must land last** because it removes sidebar entries that point at routes touched by A–E.

Each plan ends with:
- `gitnexus_detect_changes()` verification (per project CLAUDE.md)
- A SemVer minor-bump tag per [auto-ship memory](../../../../../.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/feedback_auto_ship.md)
- A wiki sync check per [wiki discipline memory](../../../../../.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/project_wiki_sync.md) when the feature is user-visible

## Shared Conventions (apply to every plan)

Pulled from [nexus/CLAUDE.md](../../../../nexus/CLAUDE.md) + [memory/project_nexus_conventions.md](../../../../../.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/project_nexus_conventions.md):

- **Tab-routing:** use `?tab=<id>` as the single source of truth for the active tab. Use `useSearchParams()` + `useRouter().replace()` to read/write; avoid `useState` so deep-links work.
- **Imports:** extensionless (`@/components/...`), no `.tsx` in imports.
- **CSRF:** mutations use `useCsrfMutation` from `@/lib/create-csrf-mutation`; cookie name `nexus_csrf`, header `X-Nexus-CSRF`.
- **Query keys:** detail pages already use `['vm', node, vmid]` / `['ct', node, vmid]` / `['node', node, 'status']` — don't rename.
- **TabBar:** import from `@/components/dashboard/tab-bar`. Props: `tabs`, `value`, `onChange`, `className?`. See [nexus/src/components/dashboard/tab-bar.tsx](../../../../nexus/src/components/dashboard/tab-bar.tsx).
- **Tests:** node-native `node:test` + `node:assert/strict`. Test files go next to source as `*.test.ts` (pattern: [sidebar.test.ts](../../../../nexus/src/components/dashboard/sidebar.test.ts)). Run with `npm run test` from `nexus/`.
- **Impact analysis:** before editing any symbol, run `gitnexus_impact({target: "<name>", direction: "upstream"})`. Flag HIGH/CRITICAL to the user before proceeding.

## Route Redirect Pattern (used in A, C, D)

Old routes stay live during rollout as redirects. Pattern:

```tsx
// nexus/src/app/(app)/dashboard/schedules/page.tsx — AFTER rollout
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/automation?tab=scheduled'); }
```

Remove the redirect stub one release after Plan F lands, once telemetry shows zero traffic.

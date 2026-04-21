# Plan F — Sidebar Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink [nexus/src/components/dashboard/sidebar.tsx](../../../../nexus/src/components/dashboard/sidebar.tsx) from 28 entries → 13 entries, matching the target layout from [SIDEBAR-CONSOLIDATION.md](../../../../SIDEBAR-CONSOLIDATION.md). This is the keystone commit — after it lands, the consolidated UX is visible to users.

**Prerequisite:** Plans A, B, C, D, E have all shipped. Every route removed from the sidebar must either (a) still render its content, or (b) redirect to the new home. If any of A–E are *not* yet merged, **stop and ship the missing plans first** — otherwise users click a sidebar row that points at a redirect-to-self loop or a 404.

**Architecture:** Single-file change (plus its test). Edit the `sections` array in `sidebar.tsx` to the new 13-item layout. Update `sidebar.test.ts` to lock the new invariants.

**Tech Stack:** React · lucide-react · node:test.

---

## File Structure

- **Modify:**
  - `nexus/src/components/dashboard/sidebar.tsx` — rewrite `sections` constant
  - `nexus/src/components/dashboard/sidebar.test.ts` — invariant tests for the new layout

**No new files.**

---

## Task 1 — Prerequisite verification

- [ ] **Step 1.1: Confirm all five roll-up plans are merged**

Check that each of the following routes is either a tabbed shell or a redirect stub:

```bash
cd /Users/devlin/Documents/GitHub/Proxmox
# Tabbed shells that must exist:
ls nexus/src/app/\(app\)/dashboard/automation/page.tsx
ls nexus/src/app/\(app\)/dashboard/cluster/page.tsx
ls nexus/src/app/\(app\)/dashboard/system/page.tsx

# Redirect stubs that must redirect:
grep -l "redirect(" nexus/src/app/\(app\)/scripts/page.tsx \
                    nexus/src/app/\(app\)/dashboard/schedules/page.tsx \
                    nexus/src/app/\(app\)/dashboard/chains/page.tsx \
                    nexus/src/app/\(app\)/dashboard/nodes/page.tsx \
                    nexus/src/app/\(app\)/dashboard/vms/page.tsx \
                    nexus/src/app/\(app\)/dashboard/cts/page.tsx \
                    nexus/src/app/\(app\)/dashboard/cluster/ha/page.tsx \
                    nexus/src/app/\(app\)/dashboard/cluster/drs/page.tsx \
                    nexus/src/app/\(app\)/dashboard/cluster/backups/page.tsx \
                    nexus/src/app/\(app\)/dashboard/cluster/firewall/page.tsx \
                    nexus/src/app/\(app\)/dashboard/cluster/pools/page.tsx \
                    nexus/src/app/\(app\)/dashboard/system/power/page.tsx \
                    nexus/src/app/\(app\)/dashboard/system/network/page.tsx \
                    nexus/src/app/\(app\)/dashboard/system/logs/page.tsx \
                    nexus/src/app/\(app\)/dashboard/system/packages/page.tsx \
                    nexus/src/app/\(app\)/dashboard/system/certificates/page.tsx \
                    nexus/src/app/\(app\)/dashboard/system/service-account/page.tsx
```

Expected: every file listed above exists and (for the redirect stubs) contains a `redirect(` call. If any is missing, STOP and ship the relevant plan first.

- [ ] **Step 1.2: Impact analysis on the sidebar component**

```
gitnexus_impact({target: "Sidebar", direction: "upstream"})
```

Expected: used by the app shell only. HIGH/CRITICAL shouldn't happen for UI chrome; if it does, investigate.

---

## Task 2 — Write the new sidebar-layout invariants

**Files:**
- Modify: `nexus/src/components/dashboard/sidebar.test.ts`

- [ ] **Step 2.1: Rewrite the test to lock the target layout**

```ts
// nexus/src/components/dashboard/sidebar.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sections } from './sidebar';

const flat = () => sections.flatMap((s) => s.items);

describe('sidebar — post-consolidation layout', () => {
  it('contains exactly 13 nav items across 3 sections', () => {
    assert.equal(sections.length, 3);
    assert.equal(flat().length, 13);
  });

  it('Core section has 6 items in the expected order', () => {
    const core = sections.find((s) => s.label === 'Core');
    assert.ok(core);
    assert.deepEqual(
      core.items.map((i) => i.href),
      [
        '/dashboard',
        '/console',
        '/dashboard/health',
        '/dashboard/tasks',
        '/dashboard/automation',
        '/dashboard/notifications',
      ],
    );
  });

  it('Infrastructure section has 4 items in the expected order', () => {
    const infra = sections.find((s) => s.label === 'Infrastructure');
    assert.ok(infra);
    assert.deepEqual(
      infra.items.map((i) => i.href),
      [
        '/dashboard/resources',
        '/dashboard/storage',
        '/dashboard/cluster',
        '/dashboard/federation',
      ],
    );
  });

  it('System section has 3 items in the expected order', () => {
    const sys = sections.find((s) => s.label === 'System');
    assert.ok(sys);
    assert.deepEqual(
      sys.items.map((i) => i.href),
      [
        '/dashboard/system',
        '/dashboard/cluster/access',
        '/dashboard/cluster/audit',
        // Updates — see Task 3 Step 3.2 for the decision
      ],
    );
  });

  it('does not contain any removed per-type list routes', () => {
    const hrefs = new Set(flat().map((i) => i.href));
    for (const removed of [
      '/dashboard/nodes',
      '/dashboard/vms',
      '/dashboard/cts',
      '/dashboard/cluster/pools',
      '/dashboard/schedules',
      '/dashboard/chains',
      '/scripts',
      '/dashboard/cluster/ha',
      '/dashboard/cluster/drs',
      '/dashboard/cluster/backups',
      '/dashboard/cluster/firewall',
      '/dashboard/system/power',
      '/dashboard/system/network',
      '/dashboard/system/logs',
      '/dashboard/system/packages',
      '/dashboard/system/certificates',
      '/dashboard/system/service-account',
    ]) {
      assert.equal(hrefs.has(removed), false, `${removed} should no longer be in the sidebar`);
    }
  });
});
```

> **Decision on Updates:** Plan D Task 4 left this open. If you picked Option A (keep as its own entry), add `'/dashboard/system/updates'` as the 4th System href above and change `has 3 items` → `has 4 items`. Pick one and land it here.

- [ ] **Step 2.2: Run the test and verify it fails**

```bash
cd nexus && npm run test -- --test-name-pattern='post-consolidation layout'
```

Expected: FAIL — the current sidebar still has 28 items.

---

## Task 3 — Rewrite the `sections` array

**Files:**
- Modify: `nexus/src/components/dashboard/sidebar.tsx`

- [ ] **Step 3.1: Replace the `sections` array**

```tsx
// nexus/src/components/dashboard/sidebar.tsx
// Keep the existing imports/component scaffolding. Replace ONLY the `sections`
// constant (lines 49–93 in the pre-consolidation file).

export const sections: NavSection[] = [
  {
    label: 'Core',
    items: [
      { href: '/dashboard',               label: 'Overview',      icon: LayoutDashboard },
      { href: '/console',                 label: 'Console',       icon: Terminal },
      { href: '/dashboard/health',        label: 'Health',        icon: HeartPulse },
      { href: '/dashboard/tasks',         label: 'Tasks',         icon: Activity },
      { href: '/dashboard/automation',    label: 'Automation',    icon: Zap },
      { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { href: '/dashboard/resources',  label: 'Resources',  icon: FolderTree },
      { href: '/dashboard/storage',    label: 'Storage',    icon: HardDrive },
      { href: '/dashboard/cluster',    label: 'Cluster',    icon: Network },
      { href: '/dashboard/federation', label: 'Federation', icon: Workflow },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/dashboard/system',         label: 'Node Settings', icon: Sliders },
      { href: '/dashboard/cluster/access', label: 'Users & ACL',   icon: Users },
      { href: '/dashboard/cluster/audit',  label: 'Audit Log',     icon: FileLock2 },
      // If Updates is kept as its own row (Option A), add it here:
      // { href: '/dashboard/system/updates', label: 'Updates', icon: RefreshCw },
    ],
  },
];
```

- [ ] **Step 3.2: Clean up unused lucide-react imports**

After the new `sections` array is in place, prune any `lucide-react` imports that are no longer referenced. The most likely drops: `Server`, `Monitor`, `Box`, `Code2`, `Package`, `Shield`, `ShieldCheck`, `ScrollText`, `Archive`, `Clock`, `KeyRound`, `Zap` (if not used elsewhere), `Workflow` (if Federation uses it, keep). The compiler + eslint `no-unused-vars` will flag any that remain.

```tsx
// Target import block (adjust based on Updates decision):
import {
  Server,          // keep (logo header)
  LayoutDashboard,
  Terminal,
  LogOut,
  Activity,
  HardDrive,
  Network,
  HeartPulse,
  Users,
  FolderTree,
  Workflow,
  FileLock2,
  Bell,
  Sliders,
  Zap,
  // RefreshCw,   // only if Updates stays as its own row
} from 'lucide-react';
```

- [ ] **Step 3.3: Run the sidebar test**

```bash
cd nexus && npm run test -- --test-name-pattern='post-consolidation layout'
```

Expected: PASS × 5.

- [ ] **Step 3.4: Full test suite + build**

```bash
cd nexus && npm run test && npm run build
```

Expected: clean. If any unused-import lint errors remain, drop the offending imports.

- [ ] **Step 3.5: Manual smoke**

```bash
cd nexus && npm run dev
```

Walk the sidebar: click every entry, confirm it lands on a rendering page (tabbed shell or top-level page), confirm active-state highlighting still works when clicking into child routes (e.g. opening a VM detail keeps **Resources** highlighted because `isActive` uses `startsWith(href + '/')`).

- [ ] **Step 3.6: Commit**

```bash
git add nexus/src/components/dashboard/sidebar.tsx nexus/src/components/dashboard/sidebar.test.ts
git commit -m "feat(sidebar): trim to 13-item consolidated layout"
```

---

## Task 4 — Verification and release

- [ ] **Step 4.1: Change detection**

```
gitnexus_detect_changes({scope: "staged"})
```

Expected: only the two sidebar files.

- [ ] **Step 4.2: Refresh index**

```bash
npx gitnexus analyze --embeddings
```

- [ ] **Step 4.3: Tag and push**

Per [auto-ship memory](../../../../../.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/feedback_auto_ship.md) this is a user-visible feature completion — tag a minor bump.

```bash
git push
git tag v0.39.0 -m "feat(sidebar): consolidated 13-item layout"
git push --tags
```

- [ ] **Step 4.4: Wiki sync**

Per [wiki-sync memory](../../../../../.claude/projects/-Users-devlin-Documents-GitHub-Proxmox/memory/project_wiki_sync.md), update `wiki/Feature-Tour.md` and `wiki/Configuration.md` to reflect the new sidebar. Checklist:

- Feature Tour screenshots or lists that enumerate the old 28 entries → replace with the 13.
- Any "Where is X?" FAQ entries that point at removed routes → update to the new tab deep-links (e.g. "Firewall is now under Cluster → Firewall: `/dashboard/cluster?tab=firewall`").

Commit wiki edits under the same tag if the edits shipped in the same session.

- [ ] **Step 4.5: Update memory**

Write a short project memory file noting the consolidation landed, for future sessions. Create `memory/project_sidebar_consolidation_v0_39.md`:

```markdown
---
name: Sidebar consolidation v0.39.0
description: 2026-04-DD sidebar trim — 28 → 13 entries; Plans A–F in docs/superpowers/plans/2026-04-20-sidebar-consolidation/
type: project
---

v0.39.0 shipped the sidebar consolidation. Five roll-ups + one sidebar trim.

**How to apply:** when a user reports "I can't find X" for pre-consolidation features,
consult SIDEBAR-CONSOLIDATION.md for the new home and give them the deep-link
(e.g. /dashboard/cluster?tab=firewall).
```

Then index it in `MEMORY.md`:

```markdown
- [Sidebar consolidation v0.39.0](project_sidebar_consolidation_v0_39.md) — 28 → 13 entries via five tabbed shells
```

- [ ] **Step 4.6: Remove the redirect stubs (follow-up, one release later)**

Do NOT do this in this plan. Open a follow-up issue titled "Remove Plan A–E redirect stubs after one release cycle" and tag it for v0.40.0 cleanup once telemetry confirms no external traffic hits the old URLs.

---

## Self-Review

- ✅ Sidebar reduced from 28 → 13 entries, grouped 6 / 4 / 3 (or 6 / 4 / 4 if Updates stays top-level).
- ✅ Every removed entry points at a live redirect or tabbed home (Task 1 verifies).
- ✅ Sidebar test locks the new layout — reverts or accidental re-adds will fail CI.
- ✅ Unused lucide imports pruned; build stays clean.
- ✅ Release tagged + wiki + memory updated.
- ✅ Redirect-stub removal explicitly deferred — no shortcut destruction of external-bookmark support.

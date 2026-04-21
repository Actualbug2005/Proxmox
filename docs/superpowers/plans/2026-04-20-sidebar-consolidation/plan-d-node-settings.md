# Plan D — Node Settings Roll-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `/dashboard/system/{power,network,logs,packages,certificates}` into a single tabbed `/dashboard/system` page. Keep `/dashboard/system/updates` either as a sibling tab (default) or a separate route (see Task 4 decision). Move the `/system/service-account` route out — it's handled by Plan E.

**Architecture:** The `SystemLayout` (`nexus/src/app/(app)/dashboard/system/layout.tsx`) already provides `SystemNodeContext` + a node-picker header. Replace the child routes with a new index page at `nexus/src/app/(app)/dashboard/system/page.tsx` that hosts a `TabBar` + the five tab bodies. Extract each current child page's body into a `<XTab/>` component. Old child routes become redirect stubs that forward to `/dashboard/system?tab=<id>`.

**Tech Stack:** Next.js 16 App Router · `SystemNodeContext` · `TabBar` · `useSearchParams()`.

---

## File Structure

- **Create:**
  - `nexus/src/app/(app)/dashboard/system/page.tsx` — tabbed shell
  - `nexus/src/app/(app)/dashboard/system/page.test.ts`
  - `nexus/src/components/system/power-tab.tsx`
  - `nexus/src/components/system/network-tab.tsx`
  - `nexus/src/components/system/logs-tab.tsx`
  - `nexus/src/components/system/packages-tab.tsx`
  - `nexus/src/components/system/certificates-tab.tsx`
- **Modify (→ redirect stubs):**
  - `nexus/src/app/(app)/dashboard/system/power/page.tsx`
  - `nexus/src/app/(app)/dashboard/system/network/page.tsx`
  - `nexus/src/app/(app)/dashboard/system/logs/page.tsx`
  - `nexus/src/app/(app)/dashboard/system/packages/page.tsx`
  - `nexus/src/app/(app)/dashboard/system/certificates/page.tsx`
- **Keep unchanged:**
  - `nexus/src/app/(app)/dashboard/system/layout.tsx` (already provides node context + header)
  - `nexus/src/app/(app)/dashboard/system/updates/page.tsx` (Plan F keeps this as its own sidebar entry)
  - `nexus/src/app/(app)/dashboard/system/service-account/*` (handled by Plan E)

---

## Task 1 — Extract the five tab bodies

**Files:**
- Create: `nexus/src/components/system/{power,network,logs,packages,certificates}-tab.tsx`

- [ ] **Step 1.1: Impact analysis on the five page defaults**

```
gitnexus_impact({target: "PowerPage",        direction: "upstream"})
gitnexus_impact({target: "SystemNetworkPage",direction: "upstream"})
gitnexus_impact({target: "LogsPage",         direction: "upstream"})
gitnexus_impact({target: "PackagesPage",     direction: "upstream"})
gitnexus_impact({target: "CertificatesPage", direction: "upstream"})
```

Expected: framework-only. Halt on any HIGH/CRITICAL caller.

- [ ] **Step 1.2: Module-contract test**

```ts
// nexus/src/components/system/tabs.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('system tab modules', () => {
  const entries: Array<[string, string]> = [
    ['power-tab',        'PowerTab'],
    ['network-tab',      'NetworkTab'],
    ['logs-tab',         'LogsTab'],
    ['packages-tab',     'PackagesTab'],
    ['certificates-tab', 'CertificatesTab'],
  ];
  for (const [file, name] of entries) {
    it(`${file} exports ${name}`, async () => {
      const mod = await import(`./${file}`);
      assert.equal(typeof mod[name], 'function');
    });
  }
});
```

- [ ] **Step 1.3: Run and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='system tab modules'
```

Expected: FAIL × 5.

- [ ] **Step 1.4: Extract each body**

Rules for each extraction:
1. Copy the body of the old default export into a new file under `nexus/src/components/system/<name>-tab.tsx`.
2. Rename to `export function <Name>Tab()`.
3. Keep all `useSystemNode()` usage — the parent `SystemLayout` already provides it.
4. Certificates has its own internal `TabBar` (`current · acme · tunnels`) — convert that sub-tab state to `?sub=<id>` per the Plan C pattern so deep-links work.
5. Packages has `tab` state (`pve · system`) — same treatment: `?sub=<id>`.
6. Drop outermost page `<div className="space-y-6">` only if the shell supplies it. Keep feature chrome (headers, buttons).

Example for `power-tab.tsx`:

```tsx
// nexus/src/components/system/power-tab.tsx
'use client';

// (…all imports from the old system/power/page.tsx…)

export function PowerTab() {
  const { node } = useSystemNode();
  // (…body of old PowerPage…)
}
```

Repeat for `network-tab`, `logs-tab`, `packages-tab`, `certificates-tab`.

- [ ] **Step 1.5: Run tests and verify pass**

```bash
cd nexus && npm run test -- --test-name-pattern='system tab modules'
```

Expected: PASS × 5.

- [ ] **Step 1.6: Commit**

```bash
git add nexus/src/components/system/
git commit -m "refactor(system): extract power/network/logs/packages/certificates tab bodies"
```

---

## Task 2 — Build the `/dashboard/system` tabbed shell

**Files:**
- Create: `nexus/src/app/(app)/dashboard/system/page.tsx`
- Create: `nexus/src/app/(app)/dashboard/system/page.test.ts`

The `SystemLayout` already wraps children in the node-context provider + node picker, so this page just needs to host the tab bar + bodies.

- [ ] **Step 2.1: Write routing test**

```ts
// nexus/src/app/(app)/dashboard/system/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('system shell', () => {
  it('exports default component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });
  it('declares the five tab ids', async () => {
    const mod = await import('./page');
    assert.deepEqual(mod.TAB_IDS, ['power','network','logs','packages','certificates']);
  });
});
```

- [ ] **Step 2.2: Run and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='system shell'
```

Expected: FAIL.

- [ ] **Step 2.3: Write the page**

```tsx
// nexus/src/app/(app)/dashboard/system/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { TabBar, type TabItem } from '@/components/dashboard/tab-bar';
import { PowerTab }        from '@/components/system/power-tab';
import { NetworkTab }      from '@/components/system/network-tab';
import { LogsTab }         from '@/components/system/logs-tab';
import { PackagesTab }     from '@/components/system/packages-tab';
import { CertificatesTab } from '@/components/system/certificates-tab';

export const TAB_IDS = ['power','network','logs','packages','certificates'] as const;
type TabId = (typeof TAB_IDS)[number];

const TABS: readonly TabItem<TabId>[] = [
  { id: 'power',        label: 'Power'        },
  { id: 'network',      label: 'Network'      },
  { id: 'logs',         label: 'Logs'         },
  { id: 'packages',     label: 'Packages'     },
  { id: 'certificates', label: 'Certificates' },
];

function isTab(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

export default function SystemPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab: TabId = isTab(sp.get('tab')) ? (sp.get('tab') as TabId) : 'power';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    next.delete('sub');
    router.replace(`/dashboard/system?${next.toString()}`);
  };

  return (
    <div className="space-y-6">
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'power'        && <PowerTab        />}
      {tab === 'network'      && <NetworkTab      />}
      {tab === 'logs'         && <LogsTab         />}
      {tab === 'packages'     && <PackagesTab     />}
      {tab === 'certificates' && <CertificatesTab />}
    </div>
  );
}
```

Notes:
- The outer padding + node-picker header come from `SystemLayout`, so this shell deliberately has no `p-6` wrapper.
- `?tab` is owned by this shell; `?sub` is owned by the child tab. Resetting `?sub` on tab switch avoids leaking Certificates' `sub=acme` into Packages.

- [ ] **Step 2.4: Run tests and build**

```bash
cd nexus && npm run test -- --test-name-pattern='system shell'
cd nexus && npm run build
```

Expected: PASS × 2, clean build.

- [ ] **Step 2.5: Manual smoke**

```bash
cd nexus && npm run dev
```

- `/dashboard/system` — node picker + tabs visible. Power tab is default.
- Tab switches — URL updates; reload keeps tab.
- Node switch — all tabs re-fetch against the chosen node.
- `/dashboard/system?tab=certificates&sub=acme` — lands on Certificates → ACME sub.

- [ ] **Step 2.6: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/system/page.tsx nexus/src/app/\(app\)/dashboard/system/page.test.ts
git commit -m "feat(system): tabbed /dashboard/system shell"
```

---

## Task 3 — Redirect the five child routes

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/system/{power,network,logs,packages,certificates}/page.tsx`

- [ ] **Step 3.1: Write redirect tests**

```ts
// nexus/src/app/(app)/dashboard/system/power/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('system/power redirect', () => {
  it('redirects to /dashboard/system?tab=power', () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/system\?tab=power['"]\)/);
  });
});
```

Repeat for the other four (each matching its tab id).

- [ ] **Step 3.2: Run and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='system/.+ redirect'
```

Expected: FAIL × 5.

- [ ] **Step 3.3: Replace each child route with a redirect**

```tsx
// system/power/page.tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/system?tab=power'); }
```

Same pattern for network / logs / packages / certificates.

- [ ] **Step 3.4: Run tests and verify pass**

```bash
cd nexus && npm run test -- --test-name-pattern='system/.+ redirect'
```

Expected: PASS × 5.

- [ ] **Step 3.5: Manual verify**

Hit each old URL: all five redirect to the matching tab. Bookmarks survive.

- [ ] **Step 3.6: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/system/{power,network,logs,packages,certificates}/page.tsx
git commit -m "feat(system): redirect child routes to /dashboard/system?tab=..."
```

---

## Task 4 — Decide on Updates placement

**Decision record:** `/dashboard/system/updates` is cross-node and policy-driven (see its `useUpdatesPolicy` hook). Two options:

- **Option A (recommended):** Keep Updates as its own top-level sidebar entry (Plan F already lists it separately). No change needed here.
- **Option B:** Add Updates as a sixth tab to `/dashboard/system`. The node-picker header becomes irrelevant for that tab; hide it when `?tab=updates`.

**Default for this plan:** Option A. No code change. If the user later wants B, add a conditional in `SystemLayout` to hide the node-picker when `useSearchParams().get('tab') === 'updates'`, extract `UpdatesTab`, and add it to `TAB_IDS`.

- [ ] **Step 4.1: Confirm with user which option to ship.** If Option B is picked, apply the Tasks 1–3 pattern to `updates/page.tsx` as well.

---

## Task 5 — Verification and release

- [ ] **Step 5.1: Full test + build**

```bash
cd nexus && npm run test && npm run build
```

- [ ] **Step 5.2: Change detection**

```
gitnexus_detect_changes({scope: "staged"})
```

Expected: only `system/page.tsx`, the five redirect stubs, and the five extracted tab components. If `system/service-account/` or `system/updates/` show up, investigate — that's out of scope (Plans E/F).

- [ ] **Step 5.3: Refresh index**

```bash
npx gitnexus analyze --embeddings
```

- [ ] **Step 5.4: Tag and push**

```bash
git push
git tag v0.38.0 -m "feat(system): consolidate node-scoped settings into tabs"
git push --tags
```

- [ ] **Step 5.5: Wiki**

Update `wiki/Configuration.md` if it enumerates the old sub-pages; point to `/dashboard/system?tab=<id>`.

---

## Self-Review

- ✅ Spec "Collapse /dashboard/system/* into Node Settings" → Tasks 1–3.
- ✅ Sub-tab state preserved via `?sub=` (Certificates, Packages).
- ✅ Node-picker stays shared (lives in `SystemLayout`).
- ✅ Updates + Service Account explicitly out of scope (Plans F / E).
- ✅ Deep-link pattern matches Plans A & C.

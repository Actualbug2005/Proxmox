# Plan E — Service Account → Access Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Service Account management (`/dashboard/system/service-account`) into Users & ACL (`/dashboard/cluster/access`) as a 6th tab. Redirect the old route.

**Architecture:** The current `ServiceAccountPage` already uses `useCsrfMutation` and fetches `/api/system/service-account`. Extract its body into `nexus/src/components/access/service-account-tab.tsx`, add a `'service-account'` entry to the existing `TabBar` on `AccessPage`, redirect the old route. Update the sidebar test to expect the new home.

**Tech Stack:** Next.js 16 App Router · TanStack Query · `useCsrfMutation` · existing `TabBar`.

---

## File Structure

- **Create:**
  - `nexus/src/components/access/service-account-tab.tsx`
- **Modify:**
  - `nexus/src/app/(app)/dashboard/cluster/access/page.tsx` — add tab entry
  - `nexus/src/app/(app)/dashboard/system/service-account/page.tsx` → redirect stub
  - `nexus/src/components/dashboard/sidebar.test.ts` — update existing assertions (they currently *require* SA under System; see Step 4.x)

---

## Task 1 — Extract the Service Account body into an Access tab

**Files:**
- Create: `nexus/src/components/access/service-account-tab.tsx`

- [ ] **Step 1.1: Impact analysis**

```
gitnexus_impact({target: "ServiceAccountPage", direction: "upstream"})
```

Expected: framework-only plus `ServiceAccountBanner` usage (a different component). Halt on HIGH/CRITICAL.

- [ ] **Step 1.2: Module-contract test**

```ts
// nexus/src/components/access/service-account-tab.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('service-account-tab module', () => {
  it('exports ServiceAccountTab', async () => {
    const mod = await import('./service-account-tab');
    assert.equal(typeof mod.ServiceAccountTab, 'function');
  });
});
```

- [ ] **Step 1.3: Run and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='service-account-tab module'
```

Expected: FAIL.

- [ ] **Step 1.4: Copy body into new component**

1. Copy every import from `nexus/src/app/(app)/dashboard/system/service-account/page.tsx` into the new file.
2. Copy the body of `ServiceAccountPage()` into a new `export function ServiceAccountTab()`.
3. Drop the outer page `<div>` wrapper if the Access shell supplies it. Keep the section-level headings.
4. Leave the `PVEUM_SETUP` constant and `timeAgo` helper in the new file — they're only used here.

```tsx
// nexus/src/components/access/service-account-tab.tsx
'use client';

// (…imports copied verbatim…)

const PVEUM_SETUP = `…`; // keep as in the original
function timeAgo(ts: number | null): string { /* keep as in the original */ }

export function ServiceAccountTab() {
  // (…body of the old ServiceAccountPage…)
}
```

- [ ] **Step 1.5: Run test and verify pass**

```bash
cd nexus && npm run test -- --test-name-pattern='service-account-tab module'
```

Expected: PASS.

- [ ] **Step 1.6: Commit**

```bash
git add nexus/src/components/access/service-account-tab.tsx nexus/src/components/access/service-account-tab.test.ts
git commit -m "refactor(access): extract ServiceAccountTab component"
```

---

## Task 2 — Add the tab entry on the Access page

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/cluster/access/page.tsx`

- [ ] **Step 2.1: Update Access page source**

Current page has `type Tab = 'users' | 'groups' | 'roles' | 'realms' | 'acl'`. Extend:

```tsx
// nexus/src/app/(app)/dashboard/cluster/access/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { TabBar, type TabItem } from '@/components/dashboard/tab-bar';
import { UsersTab } from '@/components/access/users-tab';
import { GroupsTab } from '@/components/access/groups-tab';
import { RolesTab } from '@/components/access/roles-tab';
import { RealmsTab } from '@/components/access/realms-tab';
import { ACLTab } from '@/components/access/acl-tab';
import { ServiceAccountTab } from '@/components/access/service-account-tab';

export const TAB_IDS = ['users','groups','roles','realms','acl','service-account'] as const;
type TabId = (typeof TAB_IDS)[number];

const TABS: readonly TabItem<TabId>[] = [
  { id: 'users',           label: 'Users'            },
  { id: 'groups',          label: 'Groups'           },
  { id: 'roles',           label: 'Roles'            },
  { id: 'realms',          label: 'Realms'           },
  { id: 'acl',             label: 'ACL'              },
  { id: 'service-account', label: 'Service Account'  },
];

function isTab(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

export default function AccessPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab: TabId = isTab(sp.get('tab')) ? (sp.get('tab') as TabId) : 'users';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    router.replace(`/dashboard/cluster/access?${next.toString()}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Users &amp; ACL</h1>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Users, groups, roles, realms, ACL entries, and the Nexus service account.
        </p>
      </div>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'users'            && <UsersTab            />}
      {tab === 'groups'           && <GroupsTab           />}
      {tab === 'roles'            && <RolesTab            />}
      {tab === 'realms'           && <RealmsTab           />}
      {tab === 'acl'              && <ACLTab              />}
      {tab === 'service-account'  && <ServiceAccountTab   />}
    </div>
  );
}
```

- [ ] **Step 2.2: Write a contract test**

```ts
// nexus/src/app/(app)/dashboard/cluster/access/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('access page', () => {
  it('lists service-account as a tab id', async () => {
    const mod = await import('./page');
    assert.ok(mod.TAB_IDS.includes('service-account'));
  });
});
```

- [ ] **Step 2.3: Run tests and build**

```bash
cd nexus && npm run test -- --test-name-pattern='access page'
cd nexus && npm run build
```

Expected: PASS, clean build.

- [ ] **Step 2.4: Manual smoke**

```bash
cd nexus && npm run dev
```

- `/dashboard/cluster/access` — Users tab default.
- Click **Service Account** tab — body renders, PVEUM setup text visible, create / rotate actions work.
- `/dashboard/cluster/access?tab=service-account` — lands directly on the tab.

- [ ] **Step 2.5: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/cluster/access/
git commit -m "feat(access): add Service Account tab"
```

---

## Task 3 — Redirect the old `/system/service-account` route

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/system/service-account/page.tsx`

- [ ] **Step 3.1: Write redirect test**

```ts
// nexus/src/app/(app)/dashboard/system/service-account/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('system/service-account redirect', () => {
  it('redirects to /dashboard/cluster/access?tab=service-account', () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/cluster\/access\?tab=service-account['"]\)/);
  });
});
```

- [ ] **Step 3.2: Run and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='service-account redirect'
```

Expected: FAIL.

- [ ] **Step 3.3: Replace the page**

```tsx
// nexus/src/app/(app)/dashboard/system/service-account/page.tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/cluster/access?tab=service-account'); }
```

- [ ] **Step 3.4: Run tests and verify pass**

```bash
cd nexus && npm run test -- --test-name-pattern='service-account redirect'
```

Expected: PASS.

- [ ] **Step 3.5: Manual verify**

Visit `/dashboard/system/service-account` → redirects to Access → Service Account tab.

- [ ] **Step 3.6: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/system/service-account/page.tsx nexus/src/app/\(app\)/dashboard/system/service-account/page.test.ts
git commit -m "feat(access): redirect /system/service-account to Access tab"
```

---

## Task 4 — Update the existing sidebar assertion

The current [sidebar.test.ts](../../../../nexus/src/components/dashboard/sidebar.test.ts) *requires* Service Account to live under System and *forbids* it under Core/Infrastructure. That test will start failing as soon as Plan F lands (which removes the SA row entirely). Update it now so Plan F's sidebar change is a clean commit.

**Files:**
- Modify: `nexus/src/components/dashboard/sidebar.test.ts`

- [ ] **Step 4.1: Rewrite the Service-Account-in-sidebar assertions**

Change the existing tests from "expected SA under System" to "Service Account is reachable via Users & ACL":

```ts
// nexus/src/components/dashboard/sidebar.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sections } from './sidebar';

describe('sidebar sections', () => {
  it('has no dedicated Service Account entry (folded into Users & ACL)', () => {
    const all = sections.flatMap((s) => s.items);
    const sa = all.find((i) => i.label === 'Service Account');
    assert.equal(sa, undefined, 'Service Account now lives under /dashboard/cluster/access?tab=service-account');
  });

  it('exposes a Users & ACL entry that owns service-account', () => {
    const all = sections.flatMap((s) => s.items);
    const access = all.find((i) => i.href === '/dashboard/cluster/access');
    assert.ok(access, 'expected Users & ACL in the sidebar');
    assert.equal(access.label, 'Users & ACL');
  });
});
```

- [ ] **Step 4.2: Run the sidebar test**

```bash
cd nexus && npm run test -- --test-name-pattern='sidebar sections'
```

Expected: test 1 FAILS today (sidebar still has a SA row). We're not removing the row in this plan — Plan F does that. So this test staying red is expected; **do not** commit it here. Instead, revert the test update for now and re-add it in Plan F.

> Alternative: if you want Plan E to be self-consistent without waiting for Plan F, also remove the SA row from `sidebar.tsx` in this plan (one-line change). That tightens the dependency chain. **Recommended:** do the row removal here *and* land Plan F's broader trim later.

- [ ] **Step 4.3: If self-consistent route (recommended): remove the SA row from sidebar.tsx**

```tsx
// nexus/src/components/dashboard/sidebar.tsx — inside the System section, delete:
{ href: '/dashboard/system/service-account', label: 'Service Account', icon: KeyRound },
```

Also drop the now-unused `KeyRound` from the lucide import block.

- [ ] **Step 4.4: Run the sidebar test**

```bash
cd nexus && npm run test -- --test-name-pattern='sidebar sections'
```

Expected: PASS × 2.

- [ ] **Step 4.5: Commit**

```bash
git add nexus/src/components/dashboard/sidebar.tsx nexus/src/components/dashboard/sidebar.test.ts
git commit -m "feat(sidebar): drop Service Account row (now under Users & ACL)"
```

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

Expected scope: `access/`, `system/service-account/`, `sidebar.tsx` + its test.

- [ ] **Step 5.3: Refresh index**

```bash
npx gitnexus analyze --embeddings
```

- [ ] **Step 5.4: Tag and push**

```bash
git push
git tag v0.38.1 -m "feat(access): move Service Account into Users & ACL"
git push --tags
```

Note: this is a patch bump because the functional surface is unchanged — only the home moves. If shipped alongside Plan D, fold both into one minor bump.

---

## Self-Review

- ✅ Service Account management reaches Users & ACL via new tab.
- ✅ `/dashboard/system/service-account` redirects with tab deep-link.
- ✅ Sidebar row removed and sidebar test updated in the same commit.
- ✅ No data-layer changes (`/api/system/service-account` + its hooks remain authoritative).
- ✅ Deep-link pattern matches Plans A / C / D.

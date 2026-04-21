# Plan C — Cluster Roll-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge HA & Status (`/dashboard/cluster/ha`), Auto-DRS (`/dashboard/cluster/drs`), Backups (`/dashboard/cluster/backups`), and Firewall (`/dashboard/cluster/firewall`) into a single tabbed `/dashboard/cluster` page.

**Architecture:** Create a new tabbed shell at `nexus/src/app/(app)/dashboard/cluster/page.tsx`. Each current route already has a self-contained body — extract each body into a `<ClusterXTab/>` component. HA and Firewall already use their own internal `TabBar`s; those become *second-tier* tabs nested under the top-tier Cluster tab (the TabBar handles horizontal scroll, stacking two bars vertically is acceptable). Old routes redirect to `/dashboard/cluster?tab=<id>`. Pools stays its own modal owned by Plan B — do not include here.

**Tech Stack:** Next.js 16 App Router · `TabBar` · `useSearchParams()` · existing feature components under `components/{ha,backups,firewall,drs}`.

---

## File Structure

- **Create:**
  - `nexus/src/app/(app)/dashboard/cluster/page.tsx` — tabbed shell
  - `nexus/src/app/(app)/dashboard/cluster/page.test.ts`
  - `nexus/src/components/cluster/status-tab.tsx`
  - `nexus/src/components/cluster/drs-tab.tsx`
  - `nexus/src/components/cluster/backups-tab.tsx`
  - `nexus/src/components/cluster/firewall-tab.tsx`
- **Modify (→ redirect stubs):**
  - `nexus/src/app/(app)/dashboard/cluster/ha/page.tsx`
  - `nexus/src/app/(app)/dashboard/cluster/drs/page.tsx`
  - `nexus/src/app/(app)/dashboard/cluster/backups/page.tsx`
  - `nexus/src/app/(app)/dashboard/cluster/firewall/page.tsx`

---

## Task 1 — Extract the four tab bodies

**Files:**
- Create: `nexus/src/components/cluster/{status,drs,backups,firewall}-tab.tsx`

- [ ] **Step 1.1: Impact analysis on the four page defaults**

```
gitnexus_impact({target: "HAPage",           direction: "upstream"})
gitnexus_impact({target: "DrsPage",          direction: "upstream"})
gitnexus_impact({target: "BackupsPage",      direction: "upstream"})
gitnexus_impact({target: "ClusterFirewallPage", direction: "upstream"})
```

Expected: framework-only. Any other caller → STOP and escalate.

- [ ] **Step 1.2: Write module-contract tests**

```ts
// nexus/src/components/cluster/status-tab.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('cluster tab modules', () => {
  for (const name of ['status-tab', 'drs-tab', 'backups-tab', 'firewall-tab']) {
    it(`${name} exports a named component`, async () => {
      const mod = await import(`./${name}`);
      const exportName = {
        'status-tab':   'StatusTab',
        'drs-tab':      'DrsTab',
        'backups-tab':  'BackupsTab',
        'firewall-tab': 'FirewallTab',
      }[name]!;
      assert.equal(typeof mod[exportName], 'function');
    });
  }
});
```

- [ ] **Step 1.3: Run and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='cluster tab modules'
```

Expected: FAIL × 4.

- [ ] **Step 1.4: Extract each body**

For each of `{ha,drs,backups,firewall}/page.tsx`:
1. Copy the whole body of the default export into a new file under `nexus/src/components/cluster/<name>-tab.tsx`.
2. Rename the function to the capitalised `<Name>Tab`.
3. Drop the page-level chrome (`<div className="p-6">` wrapper, `<h1>` header banner) — the shell will supply the header. **Keep internal `TabBar` sub-tabs** intact.
4. Convert any sub-tab state (`const [tab, setTab] = useState<Tab>('rules')`) to read from a secondary search-param, e.g. `?sub=<id>`, so deep-links to `/dashboard/cluster?tab=firewall&sub=options` work.

```tsx
// Example: nexus/src/components/cluster/firewall-tab.tsx
'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import { TabBar } from '@/components/dashboard/tab-bar';
import { FirewallRulesTab } from '@/components/firewall/firewall-rules-tab';
import { FirewallOptionsTab } from '@/components/firewall/firewall-options-tab';

type Sub = 'rules' | 'options' | 'aliases' | 'ipsets' | 'groups';
const SUBS = ['rules','options','aliases','ipsets','groups'] as const;
function isSub(v: string | null): v is Sub { return !!v && (SUBS as readonly string[]).includes(v); }

export function FirewallTab() {
  const sp = useSearchParams();
  const router = useRouter();
  const sub: Sub = isSub(sp.get('sub')) ? (sp.get('sub') as Sub) : 'rules';
  const setSub = (id: Sub) => {
    const next = new URLSearchParams(sp);
    next.set('sub', id);
    router.replace(`/dashboard/cluster?${next.toString()}`);
  };
  const tabs = [
    { id: 'rules'    as const, label: 'Rules' },
    { id: 'options'  as const, label: 'Options' },
    { id: 'aliases'  as const, label: 'Aliases',         disabled: true },
    { id: 'ipsets'   as const, label: 'IPSets',          disabled: true },
    { id: 'groups'   as const, label: 'Security Groups', disabled: true },
  ];
  return (
    <div className="space-y-6">
      <TabBar tabs={tabs} value={sub} onChange={setSub} />
      {sub === 'rules'   && <FirewallRulesTab />}
      {sub === 'options' && <FirewallOptionsTab />}
    </div>
  );
}
```

Apply the same pattern to `status-tab.tsx` (HA has sub-tabs `resources · groups · status`), `backups-tab.tsx` (sub-tabs `archive · jobs`), and `drs-tab.tsx` (no sub-tabs — paste body as-is, strip page chrome).

- [ ] **Step 1.5: Run tests and verify pass**

```bash
cd nexus && npm run test -- --test-name-pattern='cluster tab modules'
```

Expected: PASS × 4.

- [ ] **Step 1.6: Commit**

```bash
git add nexus/src/components/cluster/
git commit -m "refactor(cluster): extract status/drs/backups/firewall tab bodies"
```

---

## Task 2 — Build the `/dashboard/cluster` tabbed shell

**Files:**
- Create: `nexus/src/app/(app)/dashboard/cluster/page.tsx`
- Create: `nexus/src/app/(app)/dashboard/cluster/page.test.ts`

- [ ] **Step 2.1: Write routing test**

```ts
// nexus/src/app/(app)/dashboard/cluster/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('cluster shell', () => {
  it('exports default component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });
  it('declares the four tab ids', async () => {
    const mod = await import('./page');
    assert.deepEqual(mod.TAB_IDS, ['status','drs','backups','firewall']);
  });
});
```

- [ ] **Step 2.2: Run test and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='cluster shell'
```

Expected: FAIL.

- [ ] **Step 2.3: Write the page**

```tsx
// nexus/src/app/(app)/dashboard/cluster/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Network } from 'lucide-react';
import { TabBar, type TabItem } from '@/components/dashboard/tab-bar';
import { StatusTab }   from '@/components/cluster/status-tab';
import { DrsTab }      from '@/components/cluster/drs-tab';
import { BackupsTab }  from '@/components/cluster/backups-tab';
import { FirewallTab } from '@/components/cluster/firewall-tab';

export const TAB_IDS = ['status','drs','backups','firewall'] as const;
type TabId = (typeof TAB_IDS)[number];

const TABS: readonly TabItem<TabId>[] = [
  { id: 'status',   label: 'HA & Status' },
  { id: 'drs',      label: 'Auto-DRS'    },
  { id: 'backups',  label: 'Backups'     },
  { id: 'firewall', label: 'Firewall'    },
];

function isTab(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

export default function ClusterPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab: TabId = isTab(sp.get('tab')) ? (sp.get('tab') as TabId) : 'status';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    next.delete('sub'); // sub-tab state is owned by child tab, reset on switch
    router.replace(`/dashboard/cluster?${next.toString()}`);
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
          <Network className="w-5 h-5 text-[var(--color-fg-muted)]" />
          Cluster
        </h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          High-availability policy, Auto-DRS, cluster-wide backups, and firewall rules.
        </p>
      </header>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'status'   && <StatusTab   />}
      {tab === 'drs'      && <DrsTab      />}
      {tab === 'backups'  && <BackupsTab  />}
      {tab === 'firewall' && <FirewallTab />}
    </div>
  );
}
```

- [ ] **Step 2.4: Run tests and build**

```bash
cd nexus && npm run test -- --test-name-pattern='cluster shell'
cd nexus && npm run build
```

Expected: PASS × 2, clean build.

- [ ] **Step 2.5: Manual smoke**

```bash
cd nexus && npm run dev
```

Visit `/dashboard/cluster` → Status shown by default. Click each tab, check URL updates. Hit `/dashboard/cluster?tab=firewall&sub=options` → lands on Firewall → Options.

- [ ] **Step 2.6: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/cluster/page.tsx nexus/src/app/\(app\)/dashboard/cluster/page.test.ts
git commit -m "feat(cluster): tabbed /dashboard/cluster shell"
```

---

## Task 3 — Redirect the four old cluster routes

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/cluster/{ha,drs,backups,firewall}/page.tsx`

- [ ] **Step 3.1: Write redirect tests**

```ts
// nexus/src/app/(app)/dashboard/cluster/ha/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('cluster/ha redirect', () => {
  it('redirects to /dashboard/cluster?tab=status', () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/cluster\?tab=status['"]\)/);
  });
});
```

Repeat for `drs` (`tab=drs`), `backups` (`tab=backups`), `firewall` (`tab=firewall`).

- [ ] **Step 3.2: Run and verify fail**

```bash
cd nexus && npm run test -- --test-name-pattern='cluster/.+ redirect'
```

Expected: FAIL × 4.

- [ ] **Step 3.3: Replace each page with a redirect stub**

```tsx
// ha/page.tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/cluster?tab=status'); }
```

Same pattern for drs (`tab=drs`), backups (`tab=backups`), firewall (`tab=firewall`).

- [ ] **Step 3.4: Run tests and verify pass**

```bash
cd nexus && npm run test -- --test-name-pattern='cluster/.+ redirect'
```

Expected: PASS × 4.

- [ ] **Step 3.5: Manual smoke**

Visit each old URL, confirm redirect. Click through all four cluster tabs.

- [ ] **Step 3.6: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/cluster/{ha,drs,backups,firewall}/
git commit -m "feat(cluster): redirect ha/drs/backups/firewall to /dashboard/cluster"
```

---

## Task 4 — Verification and release

- [ ] **Step 4.1: Full test + build**

```bash
cd nexus && npm run test && npm run build
```

- [ ] **Step 4.2: Change detection**

```
gitnexus_detect_changes({scope: "staged"})
```

Expected: only `dashboard/cluster/*` and `components/cluster/*`.

- [ ] **Step 4.3: Refresh index**

```bash
npx gitnexus analyze --embeddings
```

- [ ] **Step 4.4: Tag and push**

```bash
git push
git tag v0.37.0 -m "feat(cluster): consolidate ha/drs/backups/firewall"
git push --tags
```

- [ ] **Step 4.5: Wiki sync**

Update `wiki/Feature-Tour.md` to describe the new /dashboard/cluster tabbed layout.

---

## Self-Review

- ✅ Spec "Merge HA & Status + Auto-DRS + Backups + Firewall" → Tasks 1–3.
- ✅ Sub-tab state preserved via `?sub=` — HA and Firewall users don't lose depth.
- ✅ Backup detail actions (restore, edit job) stay intact inside BackupsTab.
- ✅ DRS history ring still visible via `DrsTab` body (no data-loss path).
- ✅ Pools remains Plan B's modal — intentionally out of scope here.

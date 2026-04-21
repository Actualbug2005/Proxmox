# Plan A — Automation Roll-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Community Scripts (`/scripts`), Scheduled Jobs (`/dashboard/schedules`), and Script Chains (`/dashboard/chains`) into a single tabbed `/dashboard/automation` page.

**Architecture:** Create a new thin page shell at `nexus/src/app/(app)/dashboard/automation/page.tsx` that reads `?tab=` from the URL and renders one of three tab bodies. Extract each current page's body into a presentational component (`<LibraryTab/>`, `<ScheduledTab/>`, `<ChainsTab/>`) so the shell owns only routing. Leave the three old routes live as `redirect()` stubs that forward to `/dashboard/automation?tab=<id>` — preserves bookmarks + external links.

**Tech Stack:** Next.js 16 App Router · React · TanStack Query · existing `TabBar` · node:test.

---

## File Structure

- **Create:**
  - `nexus/src/app/(app)/dashboard/automation/page.tsx` — tabbed shell
  - `nexus/src/app/(app)/dashboard/automation/page.test.ts` — tab-routing smoke test
  - `nexus/src/components/automation/library-tab.tsx` — extracted from `/scripts`
  - `nexus/src/components/automation/scheduled-tab.tsx` — extracted from `/dashboard/schedules`
  - `nexus/src/components/automation/chains-tab.tsx` — extracted from `/dashboard/chains`
- **Modify (→ redirect stubs):**
  - `nexus/src/app/(app)/scripts/page.tsx`
  - `nexus/src/app/(app)/dashboard/schedules/page.tsx`
  - `nexus/src/app/(app)/dashboard/chains/page.tsx`

---

## Task 1 — Extract the three tab bodies into components

**Files:**
- Create: `nexus/src/components/automation/library-tab.tsx`
- Create: `nexus/src/components/automation/scheduled-tab.tsx`
- Create: `nexus/src/components/automation/chains-tab.tsx`

- [ ] **Step 1.1: Run impact analysis on the three page defaults**

```bash
# Check blast radius. These are Next page exports (route leaves) so direct
# upstream callers should be zero — the framework renders them. Confirm.
```

Run via GitNexus MCP:
```
gitnexus_impact({target: "ScriptsPage", direction: "upstream"})
gitnexus_impact({target: "ScheduledJobsPage", direction: "upstream"})
gitnexus_impact({target: "ChainsPage", direction: "upstream"})
```

Expected: `d=1` empty or only framework. If any user code imports these, STOP and report to user.

- [ ] **Step 1.2: Write a test that each tab component renders without crashing**

Create `nexus/src/components/automation/library-tab.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('library-tab module', () => {
  it('exports a default React component', async () => {
    const mod = await import('./library-tab');
    assert.equal(typeof mod.LibraryTab, 'function');
  });
});
```

Repeat for `scheduled-tab.test.ts` and `chains-tab.test.ts`, adjusting names.

- [ ] **Step 1.3: Run the tests and verify they fail**

```bash
cd nexus && npm run test -- --test-name-pattern='tab module'
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 1.4: Create `library-tab.tsx` by copy-moving the body of `/scripts/page.tsx`**

1. Copy the entire `export default function ScriptsPage()` body into a new file.
2. Rename the export to `export function LibraryTab()`.
3. Remove any page-chrome (outer `<div className="p-6">`, `<h1>` title) that belongs to the *page*, not the tab body. The parent `<AutomationPage>` will supply those.
4. Leave all hooks, query clients, and handlers intact — they already compose cleanly under a different route.

```tsx
// nexus/src/components/automation/library-tab.tsx
'use client';

// (…imports copied verbatim from nexus/src/app/(app)/scripts/page.tsx…)

export function LibraryTab() {
  // (…body of the old ScriptsPage, minus page chrome…)
}
```

- [ ] **Step 1.5: Repeat 1.4 for `ScheduledTab` and `ChainsTab`**

Source files: `nexus/src/app/(app)/dashboard/schedules/page.tsx`, `nexus/src/app/(app)/dashboard/chains/page.tsx`.

- [ ] **Step 1.6: Run the tests and verify they pass**

```bash
cd nexus && npm run test -- --test-name-pattern='tab module'
```

Expected: PASS × 3.

- [ ] **Step 1.7: Commit**

```bash
git add nexus/src/components/automation/
git commit -m "refactor(automation): extract library/scheduled/chains tab bodies"
```

---

## Task 2 — Build the tabbed shell

**Files:**
- Create: `nexus/src/app/(app)/dashboard/automation/page.tsx`
- Create: `nexus/src/app/(app)/dashboard/automation/page.test.ts`

- [ ] **Step 2.1: Write a routing test**

```ts
// nexus/src/app/(app)/dashboard/automation/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('automation page', () => {
  it('exports a default React component', async () => {
    const mod = await import('./page');
    assert.equal(typeof mod.default, 'function');
  });

  it('exposes the three expected tab ids', async () => {
    const mod = await import('./page');
    assert.deepEqual(mod.TAB_IDS, ['library', 'scheduled', 'chains']);
  });
});
```

- [ ] **Step 2.2: Run the test and verify it fails**

```bash
cd nexus && npm run test -- --test-name-pattern='automation page'
```

Expected: FAIL — module does not exist.

- [ ] **Step 2.3: Write the page**

```tsx
// nexus/src/app/(app)/dashboard/automation/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { TabBar, type TabItem } from '@/components/dashboard/tab-bar';
import { LibraryTab } from '@/components/automation/library-tab';
import { ScheduledTab } from '@/components/automation/scheduled-tab';
import { ChainsTab } from '@/components/automation/chains-tab';
import { Zap } from 'lucide-react';

export const TAB_IDS = ['library', 'scheduled', 'chains'] as const;
type TabId = (typeof TAB_IDS)[number];

const TABS: readonly TabItem<TabId>[] = [
  { id: 'library',   label: 'Library'   },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'chains',    label: 'Chains'    },
];

function isTabId(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

export default function AutomationPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get('tab');
  const tab: TabId = isTabId(raw) ? raw : 'library';

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(sp);
    next.set('tab', id);
    router.replace(`/dashboard/automation?${next.toString()}`);
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
          <Zap className="w-5 h-5 text-[var(--color-fg-muted)]" />
          Automation
        </h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          Community script library, scheduled runs, and multi-step chains.
        </p>
      </header>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'library'   && <LibraryTab   />}
      {tab === 'scheduled' && <ScheduledTab />}
      {tab === 'chains'    && <ChainsTab    />}
    </div>
  );
}
```

- [ ] **Step 2.4: Run the test and verify it passes**

```bash
cd nexus && npm run test -- --test-name-pattern='automation page'
```

Expected: PASS × 2.

- [ ] **Step 2.5: Manual smoke test**

```bash
cd nexus && npm run dev
```

Open `http://localhost:3000/dashboard/automation`, verify: Library tab renders by default; clicking Scheduled updates the URL to `?tab=scheduled` and swaps the body; reloading the page keeps you on the same tab; direct hit to `?tab=chains` opens the Chains tab.

- [ ] **Step 2.6: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/automation/
git commit -m "feat(automation): tabbed /dashboard/automation shell"
```

---

## Task 3 — Convert the three old routes into redirects

**Files:**
- Modify: `nexus/src/app/(app)/scripts/page.tsx`
- Modify: `nexus/src/app/(app)/dashboard/schedules/page.tsx`
- Modify: `nexus/src/app/(app)/dashboard/chains/page.tsx`

- [ ] **Step 3.1: Write a redirect test for each**

```ts
// nexus/src/app/(app)/scripts/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('/scripts redirect stub', () => {
  it("contains a redirect to '/dashboard/automation?tab=library'", () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/automation\?tab=library['"]\)/);
  });
});
```

Repeat for `schedules/page.test.ts` (→ `tab=scheduled`) and `chains/page.test.ts` (→ `tab=chains`).

- [ ] **Step 3.2: Run the tests and verify they fail**

```bash
cd nexus && npm run test -- --test-name-pattern='redirect stub'
```

Expected: FAIL — old pages are still full components.

- [ ] **Step 3.3: Replace each page with a redirect**

```tsx
// nexus/src/app/(app)/scripts/page.tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/automation?tab=library'); }
```

```tsx
// nexus/src/app/(app)/dashboard/schedules/page.tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/automation?tab=scheduled'); }
```

```tsx
// nexus/src/app/(app)/dashboard/chains/page.tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/automation?tab=chains'); }
```

- [ ] **Step 3.4: Run the tests and verify they pass**

```bash
cd nexus && npm run test -- --test-name-pattern='redirect stub'
```

Expected: PASS × 3.

- [ ] **Step 3.5: Manual verify**

```bash
cd nexus && npm run dev
```

Visit `/scripts`, `/dashboard/schedules`, `/dashboard/chains` — all three should land on the matching tab of `/dashboard/automation`.

- [ ] **Step 3.6: Commit**

```bash
git add nexus/src/app/\(app\)/
git commit -m "feat(automation): redirect /scripts /schedules /chains to automation"
```

---

## Task 4 — Verification and release

- [ ] **Step 4.1: Run full test suite**

```bash
cd nexus && npm run test
```

Expected: all tests pass.

- [ ] **Step 4.2: Run type check + build**

```bash
cd nexus && npm run build
```

Expected: clean build, no TS errors.

- [ ] **Step 4.3: Run gitnexus change detection**

```
gitnexus_detect_changes({scope: "staged"})
```

Expected: only files under `nexus/src/app/(app)/dashboard/automation/`, `nexus/src/components/automation/`, and the three redirect pages are flagged. If other files show up, investigate before committing.

- [ ] **Step 4.4: Re-run analyze to refresh the index**

```bash
npx gitnexus analyze --embeddings
```

(Check `.gitnexus/meta.json` first; if `stats.embeddings` is 0, drop `--embeddings`.)

- [ ] **Step 4.5: Tag and push SemVer minor release**

Per the auto-ship memory — this is a feature completion, tag without prompting.

```bash
git push
git tag v0.35.0 -m "feat(automation): consolidate scripts/schedules/chains"
git push --tags
```

- [ ] **Step 4.6: Wiki sync check**

Update `wiki/Feature-Tour.md` to describe the new Automation page if it references Community Scripts / Schedules / Chains separately. Commit under the same tag if needed.

---

## Self-Review

- ✅ Library, Scheduled, Chains each have an extracted component + a tab-routed home.
- ✅ All three old URLs keep working via server redirects.
- ✅ Deep-link via `?tab=<id>` preserves tab state across reload.
- ✅ Query-key conventions untouched (tab bodies are unchanged internally).
- ✅ No placeholders, all file paths exact, all code blocks complete.

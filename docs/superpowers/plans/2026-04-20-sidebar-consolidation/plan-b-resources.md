# Plan B — Resources Roll-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/dashboard/resources` the single Infrastructure entry point for browsing nodes, VMs, CTs, and pools — and demote Pools management to a modal opened from the Pools view mode.

**Architecture:** Resources already has four view modes (flat / nodes / tags / pools) via `ViewMode` in `nexus/src/lib/resource-grouping.ts`. Add a new **type filter** orthogonal to view mode (`All · Nodes · VMs · CTs`) that narrows the tree. Keep the per-type list pages as *legacy redirects* to `/dashboard/resources?type=<id>`. Keep the detail routes (`/dashboard/vms/[node]/[vmid]`, etc.) unchanged — they are the drill-down target. Wrap the existing `PoolsPage` in a modal component that opens from a "Manage pools" button on the Resources page.

**Tech Stack:** Next.js 16 App Router · existing `Segmented` component · `useSearchParams()` · `resource-grouping.ts`.

---

## File Structure

- **Create:**
  - `nexus/src/components/pools/pools-modal.tsx` — wraps existing `PoolsPage` body
  - `nexus/src/lib/resource-type-filter.ts` — filter + test fixtures
  - `nexus/src/lib/resource-type-filter.test.ts`
- **Modify:**
  - `nexus/src/app/(app)/dashboard/resources/page.tsx` — add type filter + modal trigger
  - `nexus/src/app/(app)/dashboard/cluster/pools/page.tsx` → extract body to `pools-modal.tsx`, leave redirect
  - `nexus/src/app/(app)/dashboard/nodes/page.tsx` → redirect stub
  - `nexus/src/app/(app)/dashboard/vms/page.tsx` → redirect stub
  - `nexus/src/app/(app)/dashboard/cts/page.tsx` → redirect stub

**Keep unchanged:**
- `nexus/src/app/(app)/dashboard/vms/[node]/[vmid]/page.tsx`
- `nexus/src/app/(app)/dashboard/cts/[node]/[vmid]/page.tsx`
- `nexus/src/app/(app)/dashboard/vms/create/page.tsx`, `cts/create/page.tsx`

---

## Task 1 — Add a type-filter helper and unit-test it

**Files:**
- Create: `nexus/src/lib/resource-type-filter.ts`
- Create: `nexus/src/lib/resource-type-filter.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// nexus/src/lib/resource-type-filter.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { filterByType, TYPE_IDS, type TypeFilter } from './resource-type-filter';
import type { ClusterResourcePublic } from '@/types/proxmox';

const sample: ClusterResourcePublic[] = [
  { id: 'node/pve1',   type: 'node',    status: 'online' } as ClusterResourcePublic,
  { id: 'qemu/100',    type: 'qemu',    status: 'running', node: 'pve1', vmid: 100 } as ClusterResourcePublic,
  { id: 'lxc/200',     type: 'lxc',     status: 'running', node: 'pve1', vmid: 200 } as ClusterResourcePublic,
  { id: 'storage/a',   type: 'storage', status: 'available', node: 'pve1' } as ClusterResourcePublic,
];

describe('filterByType', () => {
  it('returns everything for "all"', () => {
    assert.equal(filterByType(sample, 'all').length, 4);
  });
  it('returns only nodes for "nodes"', () => {
    const r = filterByType(sample, 'nodes');
    assert.deepEqual(r.map((x) => x.type), ['node']);
  });
  it('returns only qemu for "vms"', () => {
    assert.deepEqual(filterByType(sample, 'vms').map((x) => x.type), ['qemu']);
  });
  it('returns only lxc for "cts"', () => {
    assert.deepEqual(filterByType(sample, 'cts').map((x) => x.type), ['lxc']);
  });
  it('TYPE_IDS is frozen', () => {
    assert.deepEqual([...TYPE_IDS], ['all', 'nodes', 'vms', 'cts']);
  });
  it('rejects unknown filter at type level', () => {
    const _test: TypeFilter = 'all';
    void _test;
  });
});
```

- [ ] **Step 1.2: Run the test and verify it fails**

```bash
cd nexus && npm run test -- --test-name-pattern='filterByType'
```

Expected: FAIL — module does not exist.

- [ ] **Step 1.3: Implement the filter**

```ts
// nexus/src/lib/resource-type-filter.ts
import type { ClusterResourcePublic } from '@/types/proxmox';

export const TYPE_IDS = ['all', 'nodes', 'vms', 'cts'] as const;
export type TypeFilter = (typeof TYPE_IDS)[number];

export function filterByType(
  resources: readonly ClusterResourcePublic[],
  filter: TypeFilter,
): ClusterResourcePublic[] {
  if (filter === 'all') return [...resources];
  if (filter === 'nodes') return resources.filter((r) => r.type === 'node');
  if (filter === 'vms')   return resources.filter((r) => r.type === 'qemu');
  if (filter === 'cts')   return resources.filter((r) => r.type === 'lxc');
  const _exhaustive: never = filter;
  return _exhaustive;
}
```

- [ ] **Step 1.4: Run the test and verify it passes**

```bash
cd nexus && npm run test -- --test-name-pattern='filterByType'
```

Expected: PASS × 6.

- [ ] **Step 1.5: Commit**

```bash
git add nexus/src/lib/resource-type-filter.ts nexus/src/lib/resource-type-filter.test.ts
git commit -m "feat(resources): type-filter helper (all/nodes/vms/cts)"
```

---

## Task 2 — Wire the type filter + modal trigger into the Resources page

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/resources/page.tsx`

- [ ] **Step 2.1: Run impact analysis**

```
gitnexus_impact({target: "ResourcesPage", direction: "upstream"})
```

Expected: framework-only (it's a Next route). If HIGH/CRITICAL, report and stop.

- [ ] **Step 2.2: Write a component contract test**

```ts
// nexus/src/app/(app)/dashboard/resources/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('resources page source contract', () => {
  const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  it('wires the type filter segmented control', () => {
    assert.match(src, /TYPE_IDS/);
    assert.match(src, /type=/); // sets ?type= via router
  });
  it('wires the PoolsModal trigger', () => {
    assert.match(src, /PoolsModal/);
  });
});
```

- [ ] **Step 2.3: Run and verify it fails**

```bash
cd nexus && npm run test -- --test-name-pattern='resources page source'
```

Expected: FAIL — resources page doesn't yet reference `TYPE_IDS` or `PoolsModal`.

- [ ] **Step 2.4: Update the Resources page**

Replace `nexus/src/app/(app)/dashboard/resources/page.tsx` (keep comment header, replace the body):

```tsx
'use client';

import { useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, FolderTree } from 'lucide-react';
import { useClusterResources } from '@/hooks/use-cluster';
import { ResourceTree } from '@/components/dashboard/resource-tree';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { PoolsModal } from '@/components/pools/pools-modal';
import { TYPE_IDS, type TypeFilter, filterByType } from '@/lib/resource-type-filter';
import type { ViewMode } from '@/lib/resource-grouping';

const VIEW_OPTIONS = [
  { value: 'flat',  label: 'Flat'  },
  { value: 'nodes', label: 'Nodes' },
  { value: 'tags',  label: 'Tags'  },
  { value: 'pools', label: 'Pools' },
] as const satisfies ReadonlyArray<{ value: ViewMode; label: string }>;

const TYPE_OPTIONS = [
  { value: 'all',   label: 'All'   },
  { value: 'nodes', label: 'Nodes' },
  { value: 'vms',   label: 'VMs'   },
  { value: 'cts',   label: 'CTs'   },
] as const satisfies ReadonlyArray<{ value: TypeFilter; label: string }>;

function isType(v: string | null): v is TypeFilter {
  return v !== null && (TYPE_IDS as readonly string[]).includes(v);
}

export default function ResourcesPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const typeFilter: TypeFilter = isType(sp.get('type')) ? (sp.get('type') as TypeFilter) : 'all';
  const [viewMode, setViewMode] = useState<ViewMode>('nodes');
  const [poolsOpen, setPoolsOpen] = useState(false);
  const { data: resources, isLoading } = useClusterResources();

  const filtered = useMemo(
    () => (resources ? filterByType(resources, typeFilter) : []),
    [resources, typeFilter],
  );

  const setType = (id: TypeFilter) => {
    const next = new URLSearchParams(sp);
    if (id === 'all') next.delete('type'); else next.set('type', id);
    router.replace(`/dashboard/resources${next.toString() ? `?${next}` : ''}`);
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)] flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-[var(--color-fg-muted)]" />
            Resources
          </h1>
          <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
            Cluster-wide guest tree. Filter by type, regroup by node/tag/pool.
          </p>
        </div>
        {viewMode === 'pools' && (
          <Button variant="outline" onClick={() => setPoolsOpen(true)}>
            Manage pools
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented options={TYPE_OPTIONS}  value={typeFilter} onChange={setType} />
        <Segmented options={VIEW_OPTIONS}  value={viewMode}   onChange={setViewMode} />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-fg-subtle)]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading resources…
        </div>
      ) : (
        <ResourceTree resources={filtered} viewMode={viewMode} />
      )}

      <PoolsModal open={poolsOpen} onClose={() => setPoolsOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2.5: Run the contract test**

```bash
cd nexus && npm run test -- --test-name-pattern='resources page source'
```

Expected: PASS × 2.

- [ ] **Step 2.6: Commit (the modal file doesn't exist yet, build will fail — that's the next task)**

Don't build here. Just commit the source and move on.

```bash
git add nexus/src/app/\(app\)/dashboard/resources/page.tsx nexus/src/app/\(app\)/dashboard/resources/page.test.ts
git commit -m "feat(resources): add type filter + modal trigger (modal stub next)"
```

---

## Task 3 — Extract Pools management into a modal

**Files:**
- Create: `nexus/src/components/pools/pools-modal.tsx`
- Modify: `nexus/src/app/(app)/dashboard/cluster/pools/page.tsx` — redirect stub

- [ ] **Step 3.1: Read current Pools page**

```bash
# Review: nexus/src/app/(app)/dashboard/cluster/pools/page.tsx
```

Confirm: it's a standalone page with its own layout; no URL-derived state beyond query-client keys.

- [ ] **Step 3.2: Write the modal test**

```ts
// nexus/src/components/pools/pools-modal.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('pools-modal', () => {
  it('exports PoolsModal as a React component', async () => {
    const mod = await import('./pools-modal');
    assert.equal(typeof mod.PoolsModal, 'function');
  });
});
```

- [ ] **Step 3.3: Run and verify it fails**

```bash
cd nexus && npm run test -- --test-name-pattern='pools-modal'
```

Expected: FAIL.

- [ ] **Step 3.4: Create the modal**

```tsx
// nexus/src/components/pools/pools-modal.tsx
'use client';

import { X } from 'lucide-react';
// Copy all imports from nexus/src/app/(app)/dashboard/cluster/pools/page.tsx
// except the default export wrapper.
import { PoolsPageBody } from './pools-page-body';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PoolsModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="liquid-glass rounded-[24px] w-[min(900px,92vw)] max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">Pools</h2>
          <button aria-label="Close" onClick={onClose}
            className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <PoolsPageBody />
      </div>
    </div>
  );
}
```

Also extract the body (everything inside the old `PoolsPage()` function, minus the outer `<div className="p-6">` wrapper):

```tsx
// nexus/src/components/pools/pools-page-body.tsx
'use client';

// (…copy every import from cluster/pools/page.tsx except the default export…)

export function PoolsPageBody() {
  // (…paste the body of the old PoolsPage default export, minus outer wrapper…)
}
```

- [ ] **Step 3.5: Replace the cluster/pools route with a redirect**

```tsx
// nexus/src/app/(app)/dashboard/cluster/pools/page.tsx
import { redirect } from 'next/navigation';
export default function Page() {
  redirect('/dashboard/resources?type=all'); // view-mode=pools is client-set
}
```

- [ ] **Step 3.6: Run the modal test + build**

```bash
cd nexus && npm run test -- --test-name-pattern='pools-modal'
cd nexus && npm run build
```

Expected: tests PASS; build clean.

- [ ] **Step 3.7: Manual smoke test**

```bash
cd nexus && npm run dev
```

- Navigate to `/dashboard/resources`, switch view mode to **Pools**, click **Manage pools** → modal opens.
- Create/edit/delete a pool → tree refreshes.
- Close modal with backdrop click, X button, and `Esc` (if implemented; if not, note as follow-up).
- `/dashboard/cluster/pools` redirects to Resources.

- [ ] **Step 3.8: Commit**

```bash
git add nexus/src/components/pools/ nexus/src/app/\(app\)/dashboard/cluster/pools/page.tsx
git commit -m "feat(resources): PoolsModal + redirect /cluster/pools to Resources"
```

---

## Task 4 — Redirect `/dashboard/{nodes,vms,cts}` list pages

**Files:**
- Modify: `nexus/src/app/(app)/dashboard/nodes/page.tsx`
- Modify: `nexus/src/app/(app)/dashboard/vms/page.tsx`
- Modify: `nexus/src/app/(app)/dashboard/cts/page.tsx`

- [ ] **Step 4.1: Confirm the list pages don't host unique functionality**

Read each — if any has a "bulk lifecycle" affordance that the Resources tree does *not*, STOP and report. Otherwise continue.

- [ ] **Step 4.2: Write redirect tests**

```ts
// nexus/src/app/(app)/dashboard/nodes/page.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

describe('/dashboard/nodes redirect', () => {
  it('redirects to /dashboard/resources?type=nodes', () => {
    const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    assert.match(src, /redirect\(['"]\/dashboard\/resources\?type=nodes['"]\)/);
  });
});
```

Duplicate for `vms` (`?type=vms`) and `cts` (`?type=cts`).

- [ ] **Step 4.3: Run and verify failures**

```bash
cd nexus && npm run test -- --test-name-pattern='redirect'
```

Expected: FAIL × 3.

- [ ] **Step 4.4: Replace each page with a redirect**

```tsx
// nodes/page.tsx
import { redirect } from 'next/navigation';
export default function Page() { redirect('/dashboard/resources?type=nodes'); }
```

Same pattern for vms and cts.

- [ ] **Step 4.5: Run tests and verify they pass**

```bash
cd nexus && npm run test -- --test-name-pattern='redirect'
```

Expected: PASS × 3.

- [ ] **Step 4.6: Manual verify**

Visit `/dashboard/nodes` → lands on Resources with `type=nodes` preselected. Click a node row → detail page still works.

- [ ] **Step 4.7: Commit**

```bash
git add nexus/src/app/\(app\)/dashboard/{nodes,vms,cts}/page.tsx
git commit -m "feat(resources): redirect list pages to /dashboard/resources"
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

Expected scope: only `resources/`, `pools/`, `cluster/pools/`, `nodes/page.tsx`, `vms/page.tsx`, `cts/page.tsx`, and the new lib + components.

- [ ] **Step 5.3: Refresh index**

```bash
npx gitnexus analyze --embeddings
```

- [ ] **Step 5.4: Tag and push**

```bash
git push
git tag v0.36.0 -m "feat(resources): type filter + pools modal + list redirects"
git push --tags
```

- [ ] **Step 5.5: Wiki**

Update `wiki/Feature-Tour.md` if it references the old Nodes/VMs/CTs/Pools sidebar structure.

---

## Self-Review

- ✅ Spec section "Collapse Nodes / VMs / CTs / Pools under Resources" → Tasks 2 + 4.
- ✅ Spec section "Pools becomes a modal" → Task 3.
- ✅ Detail routes (`/vms/[node]/[vmid]`, etc.) preserved intact.
- ✅ URL state is the source of truth (`?type=`); reload-safe.
- ✅ Deep-link pattern matches Plan A.

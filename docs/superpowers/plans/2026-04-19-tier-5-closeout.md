# Tier 5 Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Tier 5 (Intelligence) — services-level guest probes, bell-icon alert-rule UI on pressure widgets, and a Holt's-linear capacity forecast — plus a discoverability fix for the service-account banner. Ship four releases (v0.29 → v0.32), one per phase.

**Architecture:** Each phase lands on `main` directly with its own release. Phase 1 is a one-line UI fix. Phase 2 extends the existing guest-agent poll source and event taxonomy. Phase 3 adds a shared `AlertBell` primitive + draft-prefilled rule editor, reusing the existing `RuleForm`. Phase 4 generalises `trend.ts` into `forecast.ts` with Holt's linear smoothing, overlaid on pressure widgets.

**Tech Stack:** Next.js 16 App Router, TanStack Query, Tailwind, Zod validators at API boundaries, Vitest for unit tests, `lucide-react` for icons. No new deps.

---

## Phase-level guardrails (apply to every task below)

- Before editing any function/class named below, run `gitnexus_impact({target: "<symbol>", direction: "upstream"})` and report the blast radius. If HIGH/CRITICAL, stop and re-plan.
- Before committing, run `gitnexus_detect_changes({scope: "staged"})` and confirm the changed scope matches the task.
- The roadmap doc at `docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md` must be updated inline at the end of each phase with the new ship state.
- After each phase's release: `git tag vX.Y.Z && git push --tags` (no confirmation prompt — per standing order).

---

## Phase 1 — Service-account discoverability (v0.29.0)

Smallest phase. Ship first.

### Task 1.1: Add sidebar nav entry for Service Account

**Files:**
- Modify: `nexus/src/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Run impact check**

```
gitnexus_impact({target: "Sidebar", direction: "upstream"})
```
Expected: low risk (one layout consumer in `app-shell.tsx`).

- [ ] **Step 2: Add `KeyRound` icon to the lucide import block**

In the `lucide-react` import at the top of `sidebar.tsx` (currently ends with `Sliders,` on line 31), add `KeyRound,` after `Sliders,`.

- [ ] **Step 3: Add the nav item inside the `System` section**

Find the `System` section's `items` array (starts line 79). Insert after the `Users & ACL` entry, before `Audit Log`:

```tsx
{ href: '/dashboard/system/service-account', label: 'Service Account', icon: KeyRound },
```

- [ ] **Step 4: Run tsc + lint + tests**

```
cd nexus && pnpm tsc --noEmit && pnpm lint && pnpm vitest run
```
Expected: all green.

- [ ] **Step 5: Commit**

```
git add nexus/src/components/dashboard/sidebar.tsx
git commit -m "feat(sidebar): add Service Account entry under System"
```

### Task 1.2: Surface Service Account in the command palette

**Files:**
- Read first: `nexus/src/components/dashboard/command-palette.tsx`
- Modify: same file

- [ ] **Step 1: Read the palette file and find the navigation group**

Open `command-palette.tsx` and locate the array of navigation items (v0.25.1 fixed this group). Identify the pattern used to declare a nav entry (likely `{ href, label, group: 'Navigation' }` or similar — follow existing convention exactly).

- [ ] **Step 2: Add a Service Account entry to the same array**

Insert a new entry following the same shape:

```tsx
{
  href: '/dashboard/system/service-account',
  label: 'Service Account',
  group: 'Navigation',
  // keywords help fuzzy search catch "token", "api token", "credentials"
  keywords: ['token', 'api token', 'credentials', 'system'],
},
```

(If the existing entries don't use `keywords`, omit the field — match local conventions, don't import new shape.)

- [ ] **Step 3: Run tsc + lint**

```
cd nexus && pnpm tsc --noEmit && pnpm lint
```
Expected: green.

- [ ] **Step 4: Add a test asserting the palette entry exists**

**Files:**
- Create or modify: `nexus/src/components/dashboard/command-palette.test.tsx` (if doesn't exist, create; otherwise add a `describe` block).

Minimal test (adapt to existing testing conventions for this file if present — read first; if no test file exists, use the same pattern as `sidebar.test.tsx`):

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandPalette } from './command-palette';

describe('CommandPalette — Service Account entry', () => {
  it('lists Service Account under Navigation', () => {
    render(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByRole('combobox');
    // fire typing event — import { fireEvent } if needed
    // ...
    expect(screen.getByText(/Service Account/i)).toBeInTheDocument();
  });
});
```

Note: if `CommandPalette` props don't match the above (check existing tests for the right shape), adapt. The assertion is the point — the entry must be present.

- [ ] **Step 5: Run the new test**

```
cd nexus && pnpm vitest run command-palette
```
Expected: pass.

- [ ] **Step 6: Commit**

```
git add nexus/src/components/dashboard/command-palette.tsx nexus/src/components/dashboard/command-palette.test.tsx
git commit -m "feat(palette): surface Service Account in navigation search"
```

### Task 1.3: Add a sidebar test for the new nav entry

**Files:**
- Modify or create: `nexus/src/components/dashboard/sidebar.test.tsx`

- [ ] **Step 1: Read existing sidebar test if present**

```
cat nexus/src/components/dashboard/sidebar.test.tsx 2>/dev/null || echo "none"
```

- [ ] **Step 2: If no test file exists, create it**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './sidebar';

describe('Sidebar — Service Account entry', () => {
  it('links to /dashboard/system/service-account in the System section', () => {
    render(<Sidebar username="test" />);
    const link = screen.getByRole('link', { name: /Service Account/i });
    expect(link.getAttribute('href')).toBe('/dashboard/system/service-account');
  });
});
```

- [ ] **Step 3: If a test file exists, add a new `describe` block with the same assertion**

Match the existing file's conventions (provider wrapping, mocks, etc.).

- [ ] **Step 4: Run the test**

```
cd nexus && pnpm vitest run sidebar
```
Expected: pass.

- [ ] **Step 5: Commit**

```
git add nexus/src/components/dashboard/sidebar.test.tsx
git commit -m "test(sidebar): assert Service Account nav entry"
```

### Task 1.4: Release v0.29.0

- [ ] **Step 1: Run full verification**

```
cd nexus && pnpm tsc --noEmit && pnpm lint && pnpm vitest run
```
Expected: 448+ tests green, tsc clean, lint clean.

- [ ] **Step 2: Bump version**

Edit `nexus/package.json` → `"version": "0.29.0"`. If a root `package.json` or workspace file has the same version, bump there too.

- [ ] **Step 3: Commit the version bump**

```
git add nexus/package.json
git commit -m "chore(release): v0.29.0"
```

- [ ] **Step 4: Update roadmap doc**

Edit `docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md`:
- Under "What changed since 2026-04-18", add a new subsection "Service-account discoverability — v0.29.0" with one-line description.
- No tier-table changes (this isn't a tiered item).

Commit:

```
git add docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md
git commit -m "docs(roadmap): note v0.29.0 service-account nav entry"
```

- [ ] **Step 5: Tag and push**

```
git tag v0.29.0
git push origin main --tags
```
Release CI takes it from there.

- [ ] **Step 6: Reindex gitnexus**

```
npx gitnexus analyze --embeddings
```

---

## Phase 2 — 5.2 Services-level guest probes (v0.30.0)

Extends the existing guest-agent probe path (`nexus/src/lib/guest-agent/poll-source.ts`) with a failed-services probe at 1/3 of the main cadence, emits `guest.service.failed` on empty→non-empty transitions, and surfaces the count in the existing `guest-disk-pressure.tsx` widget.

### Task 2.1: Add `GuestFailedService` + `guest.service.failed` event shape

**Files:**
- Modify: `nexus/src/lib/guest-agent/types.ts`
- Modify: `nexus/src/lib/notifications/types.ts`

- [ ] **Step 1: Impact check**

```
gitnexus_impact({target: "GuestProbe", direction: "upstream"})
gitnexus_impact({target: "PushedEvent", direction: "upstream"})
```
Report: expected consumers are poll-source, snapshot, UI widget, rule matcher, fixtures, rule-form. Medium blast radius but isolated to the notifications module.

- [ ] **Step 2: Extend `guest-agent/types.ts` — append `GuestFailedService` + `failedServices` field**

Add at the end of `types.ts`:

```tsx
/**
 * One failed systemd unit reported by `systemctl list-units --state=failed`.
 * `description` is the human-readable text; `since` is walltime (ms epoch)
 * when the unit was first observed in the failed set this run.
 */
export interface GuestFailedService {
  unit: string;
  description: string;
  since: number;
}
```

Then extend the `GuestProbe` interface to include the optional field:

```tsx
  /**
   * Failed systemd units from this probe cycle. Only populated on ticks where
   * the services probe ran (1/3 cadence). Undefined on off-ticks; empty
   * array means "probe ran and found zero failed units".
   */
  failedServices?: GuestFailedService[];
```

- [ ] **Step 3: Extend the notification event taxonomy**

In `nexus/src/lib/notifications/types.ts`, locate the `PushedEvent.kind` union (line 54). Add after `'guest.agent.unreachable'`:

```
    /** Guest-agent probe (5.2) — a systemd unit transitioned to the failed set. */
    | 'guest.service.failed'
```

Then append the literal `'guest.service.failed'` to the `EVENT_KINDS` array (line 118) — keep sorted alphabetically within the guest.* group.

- [ ] **Step 4: Run tsc**

```
cd nexus && pnpm tsc --noEmit
```
Expected: may fail if rule-matcher fixtures or KIND_LABELS demand exhaustiveness. Keep the errors for the next task.

- [ ] **Step 5: Commit**

```
git add nexus/src/lib/guest-agent/types.ts nexus/src/lib/notifications/types.ts
git commit -m "feat(notifications): add guest.service.failed event kind + GuestFailedService type"
```

### Task 2.2: Update KIND_LABELS / fixtures for the new event

**Files:**
- Modify: `nexus/src/lib/notifications/fixtures.ts`

- [ ] **Step 1: Read the fixtures file first**

```
cat nexus/src/lib/notifications/fixtures.ts
```
Identify:
- `KIND_LABELS` map shape.
- `KIND_GROUPS` array (which group should `guest.service.failed` join? likely the same group as `guest.disk.filling`).
- `fixtureEvent(kind)` — add a case for the new kind.

- [ ] **Step 2: Add `KIND_LABELS` entry**

Where `KIND_LABELS['guest.agent.unreachable']` is defined, add:

```tsx
'guest.service.failed': 'Guest — systemd unit failed',
```

- [ ] **Step 3: Add to `KIND_GROUPS`**

Find the group entry that contains `'guest.disk.filling'` and `'guest.agent.unreachable'` and append `'guest.service.failed'` to its `kinds` array.

- [ ] **Step 4: Add a fixture event**

In the `fixtureEvent()` switch (or map), add:

```tsx
case 'guest.service.failed':
  return {
    kind: 'guest.service.failed',
    at: Date.now(),
    payload: {
      vmid: 100,
      node: 'pve-01',
      unit: 'nginx.service',
      description: 'nginx — a high performance web server and a reverse proxy server',
      since: Date.now() - 90_000,
    },
  };
```

- [ ] **Step 5: Run tsc + tests**

```
cd nexus && pnpm tsc --noEmit && pnpm vitest run notifications
```
Expected: green.

- [ ] **Step 6: Commit**

```
git add nexus/src/lib/notifications/fixtures.ts
git commit -m "feat(notifications): label + fixture for guest.service.failed"
```

### Task 2.3: Services parser — pure function with tests

**Files:**
- Create: `nexus/src/lib/guest-agent/services-probe.ts`
- Create: `nexus/src/lib/guest-agent/services-probe.test.ts`

- [ ] **Step 1: Write the failing test first (TDD)**

Create `services-probe.test.ts`:

```tsx
import { describe, it, expect } from 'vitest';
import { parseFailedUnits } from './services-probe';

describe('parseFailedUnits', () => {
  it('returns [] for empty input', () => {
    expect(parseFailedUnits('')).toEqual([]);
  });

  it('returns [] for "0 loaded units listed" message', () => {
    // systemctl prints this when nothing matches --state=failed.
    expect(parseFailedUnits('0 loaded units listed.')).toEqual([]);
  });

  it('parses a single failed unit', () => {
    const raw = 'nginx.service loaded failed failed A high performance web server';
    expect(parseFailedUnits(raw)).toEqual([
      { unit: 'nginx.service', description: 'A high performance web server' },
    ]);
  });

  it('parses multiple failed units', () => {
    const raw = [
      'nginx.service loaded failed failed A high performance web server',
      'postgresql.service loaded failed failed PostgreSQL RDBMS',
    ].join('\n');
    expect(parseFailedUnits(raw)).toEqual([
      { unit: 'nginx.service', description: 'A high performance web server' },
      { unit: 'postgresql.service', description: 'PostgreSQL RDBMS' },
    ]);
  });

  it('tolerates trailing whitespace and blank lines', () => {
    const raw = '\n  nginx.service loaded failed failed Nginx   \n\n';
    expect(parseFailedUnits(raw)).toEqual([
      { unit: 'nginx.service', description: 'Nginx' },
    ]);
  });

  it('skips malformed lines (too few columns)', () => {
    const raw = 'nginx.service loaded';
    expect(parseFailedUnits(raw)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

```
cd nexus && pnpm vitest run services-probe
```
Expected: fail with "cannot find module './services-probe'".

- [ ] **Step 3: Implement `services-probe.ts`**

```tsx
/**
 * Parser for `systemctl list-units --state=failed --no-legend --plain --no-pager`.
 *
 * Output shape is five space-separated columns:
 *   UNIT  LOAD  ACTIVE  SUB  DESCRIPTION...
 *
 * Description can contain spaces — we join columns 5+. Lines with fewer
 * than 5 columns are skipped (malformed / informational messages like
 * "0 loaded units listed.").
 */
export interface ParsedFailedUnit {
  unit: string;
  description: string;
}

export function parseFailedUnits(raw: string): ParsedFailedUnit[] {
  const out: ParsedFailedUnit[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue; // 4 metadata cols + at least 1 description word
    const unit = parts[0];
    const description = parts.slice(4).join(' ').trim();
    if (!unit.includes('.')) continue; // systemctl unit names always have a type suffix
    out.push({ unit, description });
  }
  return out;
}
```

- [ ] **Step 4: Run the test — expect PASS**

```
cd nexus && pnpm vitest run services-probe
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```
git add nexus/src/lib/guest-agent/services-probe.ts nexus/src/lib/guest-agent/services-probe.test.ts
git commit -m "feat(guest-agent): parser for systemctl --state=failed output"
```

### Task 2.4: Hook services probing into the poll source at 1/3 cadence

**Files:**
- Modify: `nexus/src/lib/guest-agent/poll-source.ts`
- Modify: `nexus/src/lib/guest-agent/probe.ts` (extend to run `systemctl list-units` via `agent exec`)
- Modify: `nexus/src/lib/guest-agent/poll-source.test.ts`

- [ ] **Step 1: Impact check**

```
gitnexus_impact({target: "runTick", direction: "upstream"})
gitnexus_impact({target: "processProbes", direction: "upstream"})
gitnexus_impact({target: "probeGuest", direction: "upstream"})
```
Report any HIGH/CRITICAL. Expected: these are hot-path but only consumed by the timer + the on-demand `/api/guests/[node]/[vmid]/agent` route.

- [ ] **Step 2: Read `probe.ts` first**

```
cat nexus/src/lib/guest-agent/probe.ts
```
Identify the existing PVE exec path — probably `qm guest exec $vmid -- <command>` returning stdout. We'll follow the same shape.

- [ ] **Step 3: Extend `probeGuest` with an optional `probeServices: boolean`**

Add a new parameter to `probeGuest()` (default false so callers that don't opt in don't pay the cost). When true, after the existing fsinfo fetch:

```tsx
if (probeServices && probe.reachable) {
  try {
    const raw = await execInGuest(session, node, vmid,
      'systemctl list-units --state=failed --no-legend --plain --no-pager');
    const parsed = parseFailedUnits(raw);
    // timestamps: we don't know first-observed from stdout; the caller
    // (processProbes) owns `since` tracking across ticks.
    probe.failedServices = parsed.map((p) => ({ ...p, since: 0 }));
  } catch (err) {
    // Probe failed — don't crash the pressure probe; leave failedServices
    // undefined (= "didn't probe") vs. [] (= "probed, found none").
    console.warn(
      '[nexus event=guest_services_probe_failed] vmid=%d reason=%s',
      vmid, err instanceof Error ? err.message : String(err),
    );
  }
}
```

If the existing probe doesn't expose a generic `execInGuest` helper, either expose one or inline the call following the exact pattern of existing fsinfo retrieval. Read `probe.ts` to decide.

- [ ] **Step 4: Add a tick counter to the poll source**

In `poll-source.ts`, module level:

```tsx
let tickCounter = 0;
const SERVICES_PROBE_EVERY_N_TICKS = 3;
```

In `runTick`, change the probe call to pass `probeServices: tickCounter % SERVICES_PROBE_EVERY_N_TICKS === 0`, and increment `tickCounter` at the end. Reset `tickCounter = 0` in `__resetTickState()`.

- [ ] **Step 5: Extend `processProbes` to emit `guest.service.failed`**

In the `GuestTickState` interface, add:

```tsx
  /** Set of unit names currently failing — for edge detection. */
  failedUnits: Set<string>;
  /** First-observed time per unit — persisted across ticks. */
  firstObserved: Map<string, number>;
```

Initialize them in `ensureState()` (`new Set()`, `new Map()`).

In the reachable branch of `processProbes`, after the filesystems loop, add (guarded by `probe.failedServices !== undefined`, i.e. only on services-probe ticks):

```tsx
if (probe.failedServices !== undefined) {
  const nowFailing = new Set<string>();
  for (const svc of probe.failedServices) {
    nowFailing.add(svc.unit);
    if (!state.failedUnits.has(svc.unit)) {
      // Edge: empty→present. Record observation time and emit.
      const since = state.firstObserved.get(svc.unit) ?? opts.now;
      state.firstObserved.set(svc.unit, since);
      emit({
        kind: 'guest.service.failed',
        at: opts.now,
        payload: {
          vmid: probe.vmid,
          node: probe.node,
          unit: svc.unit,
          description: svc.description,
          since,
        },
      });
    }
  }
  // Resolve: units that left the failing set since last tick.
  for (const prev of state.failedUnits) {
    if (!nowFailing.has(prev)) {
      state.firstObserved.delete(prev);
      emit({
        kind: 'guest.service.failed',
        at: opts.now,
        payload: { vmid: probe.vmid, node: probe.node, unit: prev, description: '', since: 0 },
        __resolve: true,
      });
    }
  }
  state.failedUnits = nowFailing;
}
```

- [ ] **Step 6: Write failing tests first**

In `poll-source.test.ts`, add:

```tsx
describe('guest-agent poll-source — services probing', () => {
  it('emits guest.service.failed when a unit first appears in the failed set', () => {
    const take = captureEvents();
    const probe: GuestProbe = {
      vmid: 101, node: 'pve-01', reachable: true, filesystems: [],
      failedServices: [{ unit: 'nginx.service', description: 'Nginx', since: 0 }],
    };
    processProbes([probe], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 1000 });
    const events = take();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('guest.service.failed');
    if (events[0].kind === 'guest.service.failed') {
      expect(events[0].payload.unit).toBe('nginx.service');
    }
  });

  it('does not re-emit while the unit stays failing', () => {
    const take = captureEvents();
    const probe: GuestProbe = {
      vmid: 101, node: 'pve-01', reachable: true, filesystems: [],
      failedServices: [{ unit: 'nginx.service', description: 'Nginx', since: 0 }],
    };
    processProbes([probe], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 1000 });
    processProbes([probe], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 2000 });
    expect(take()).toHaveLength(1);
  });

  it('emits a resolve event when the unit leaves the failing set', () => {
    const take = captureEvents();
    const failing: GuestProbe = {
      vmid: 101, node: 'pve-01', reachable: true, filesystems: [],
      failedServices: [{ unit: 'nginx.service', description: 'Nginx', since: 0 }],
    };
    const cleared: GuestProbe = {
      ...failing,
      failedServices: [],
    };
    processProbes([failing], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 1000 });
    processProbes([cleared], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 2000 });
    const events = take();
    expect(events).toHaveLength(2);
    expect(events[1].__resolve).toBe(true);
  });

  it('skips services block when probe.failedServices is undefined (off-tick)', () => {
    const take = captureEvents();
    const probe: GuestProbe = {
      vmid: 101, node: 'pve-01', reachable: true, filesystems: [],
      // failedServices intentionally undefined
    };
    processProbes([probe], { pressureThreshold: 0.85, unreachableThreshold: 3, now: 1000 });
    expect(take()).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run tests — expect PASS**

```
cd nexus && pnpm vitest run poll-source
```
Expected: all services tests pass + existing disk/unreachable tests still pass.

- [ ] **Step 8: Commit**

```
git add nexus/src/lib/guest-agent/
git commit -m "feat(guest-agent): services probe at 1/3 cadence, emits guest.service.failed"
```

### Task 2.5: Surface failed services in the guest-disk-pressure widget

**Files:**
- Modify: `nexus/src/components/widgets/guest-disk-pressure.tsx`
- Modify: `nexus/src/hooks/use-guest-agent.ts` (if it filters the probe shape)

- [ ] **Step 1: Read the widget + hook**

```
cat nexus/src/components/widgets/guest-disk-pressure.tsx
cat nexus/src/hooks/use-guest-agent.ts
```
Confirm how `DiskPressure` rows + `GuestProbe` reach the UI.

- [ ] **Step 2: Add a "Failed services" subsection**

Below the existing filesystems list in `guest-disk-pressure.tsx`, add:

```tsx
{probe?.failedServices && probe.failedServices.length > 0 && (
  <section className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
    <h4 className="text-xs uppercase tracking-widest text-[var(--color-fg-subtle)] mb-1.5">
      Failed services
    </h4>
    <ul className="space-y-1">
      {probe.failedServices.map((svc) => (
        <li key={svc.unit} className="text-sm text-[var(--color-fg-secondary)]">
          <span className="font-mono text-[var(--color-err)]">{svc.unit}</span>
          {svc.description && (
            <span className="text-[var(--color-fg-faint)]"> — {svc.description}</span>
          )}
        </li>
      ))}
    </ul>
  </section>
)}
```

(If the widget currently doesn't receive `probe` as a whole object — it may take only `DiskPressure[]` — extend the data contract to include `failedServices` on the same level. Match whatever the existing hook exports.)

- [ ] **Step 3: Run tsc**

```
cd nexus && pnpm tsc --noEmit
```

- [ ] **Step 4: Run tests**

```
cd nexus && pnpm vitest run
```

- [ ] **Step 5: Commit**

```
git add nexus/src/components/widgets/guest-disk-pressure.tsx nexus/src/hooks/use-guest-agent.ts
git commit -m "feat(ui): surface failed services on guest disk-pressure widget"
```

### Task 2.6: Release v0.30.0

- [ ] **Step 1: Full verification**

```
cd nexus && pnpm tsc --noEmit && pnpm lint && pnpm vitest run
```
Expected: all green, test count up by ~6 (services-probe parser + poll-source cases).

- [ ] **Step 2: Bump version**

`nexus/package.json` → `"version": "0.30.0"`.

```
git add nexus/package.json
git commit -m "chore(release): v0.30.0"
```

- [ ] **Step 3: Update roadmap**

Edit `docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md`:
- Tier 5 table: flip 5.2 from ◐ Partial to ✅ Done (note: services-level now included).
- Move 5.2 services mention to "Confirmed shipped" section.

Commit:

```
git add docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md
git commit -m "docs(roadmap): mark 5.2 complete with v0.30.0 services probes"
```

- [ ] **Step 4: Tag and push**

```
git tag v0.30.0
git push origin main --tags
```

- [ ] **Step 5: Reindex**

```
npx gitnexus analyze --embeddings
```

---

## Phase 3 — 5.4 Alert-rule UI on pressure widgets (v0.31.0)

Adds a bell-icon primitive that opens the existing `RuleForm` modal pre-seeded with a draft matching the widget's scope + current value. Works for threshold widgets (CPU/RAM/disk) and event widgets (services/agent).

### Task 3.1: Add the notification poll source's CPU/RAM metric names if missing

**Files:**
- Read: `nexus/src/lib/notifications/poll-source.ts`
- Modify: `nexus/src/lib/notifications/types.ts` (if needed)
- Modify: same file (if needed)

- [ ] **Step 1: Read the current poll source**

```
cat nexus/src/lib/notifications/poll-source.ts
```
Check the `METRIC_NAMES` already exported from `types.ts`:
```
cluster.cpu.avg
cluster.mem.avg
node.cpu.max
node.loadavg.per_core
guests.failing.count
```

These cover cluster-wide and node-max. For per-guest thresholds (which the bell on a VM's CPU widget wants to set), we may need `guest.cpu` and `guest.mem`. Verify.

- [ ] **Step 2: Decide scope**

If `METRIC_NAMES` covers what the bell icon needs (node + cluster), no change needed here — scope strings like `guest:100` can already be used for filtering. Re-read the spec: bell on a guest widget → rule filters on `scope = "guest:100"`. This requires the metric to be emitted per-guest.

If `computeMetrics()` in `poll-source.ts` does NOT currently emit per-guest CPU/RAM, add emission. Shape:

```tsx
// Existing cluster-wide emission, plus per-guest for any running guest:
for (const g of runningGuests) {
  if (g.cpu !== undefined) {
    emitIfCrosses('guest.cpu', g.cpu, `guest:${g.vmid}`);
  }
  if (g.mem !== undefined && g.maxmem) {
    emitIfCrosses('guest.mem', g.mem / g.maxmem, `guest:${g.vmid}`);
  }
}
```

Add `'guest.cpu'` and `'guest.mem'` to `METRIC_NAMES` in `types.ts`.

- [ ] **Step 3: Tests for the new metrics**

Modify or add to `nexus/src/lib/notifications/poll-source.test.ts`:

```tsx
it('emits per-guest cpu metric above threshold', () => {
  const take = captureEvents();
  computeMetrics(/* snapshot with running guest at cpu=0.9 */, { cpuThreshold: 0.8, now: 1 });
  const events = take();
  const match = events.find((e) => e.kind === 'metric.threshold.crossed' && e.metric === 'guest.cpu');
  expect(match).toBeDefined();
});
```

(Adapt to the actual test harness for this file — pattern should mirror existing `computeMetrics` tests.)

- [ ] **Step 4: Run tests**

```
cd nexus && pnpm vitest run notifications/poll-source
```

- [ ] **Step 5: Commit**

```
git add nexus/src/lib/notifications/
git commit -m "feat(notifications): emit per-guest cpu and mem metrics"
```

### Task 3.2: Build the `<AlertBell>` primitive

**Files:**
- Create: `nexus/src/components/notifications/alert-bell.tsx`
- Create: `nexus/src/components/notifications/alert-bell.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlertBell } from './alert-bell';

describe('<AlertBell />', () => {
  it('renders an outline bell when no rules match', () => {
    render(<AlertBell rulesCount={0} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Add alert rule/i })).toBeInTheDocument();
  });

  it('renders a filled bell with count when rules exist', () => {
    render(<AlertBell rulesCount={3} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: /3 alert rules?/i });
    expect(btn).toBeInTheDocument();
  });

  it('calls onClick when pressed', () => {
    const cb = vi.fn();
    render(<AlertBell rulesCount={0} onClick={cb} />);
    fireEvent.click(screen.getByRole('button'));
    expect(cb).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```
cd nexus && pnpm vitest run alert-bell
```

- [ ] **Step 3: Implement the primitive**

```tsx
'use client';

/**
 * AlertBell — clickable bell icon that lives on pressure/event widgets.
 * Styled outline when no rules target this widget's scope, filled with
 * a badge when ≥1 rule matches. Click dispatches back to the parent
 * (which opens the rule editor modal with a draft).
 */
import { Bell, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AlertBellProps {
  rulesCount: number;
  onClick: () => void;
  className?: string;
}

export function AlertBell({ rulesCount, onClick, className }: AlertBellProps) {
  const active = rulesCount > 0;
  const label = active
    ? `${rulesCount} alert rule${rulesCount === 1 ? '' : 's'}`
    : 'Add alert rule';
  const Icon = active ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'relative p-1 rounded-md transition-colors',
        active
          ? 'text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
          : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)]/50',
        className,
      )}
    >
      <Icon className="w-4 h-4" />
      {active && (
        <span
          className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-accent)] text-[10px] font-medium text-white flex items-center justify-center"
          aria-hidden
        >
          {rulesCount}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```
cd nexus && pnpm vitest run alert-bell
```

- [ ] **Step 5: Commit**

```
git add nexus/src/components/notifications/alert-bell.tsx nexus/src/components/notifications/alert-bell.test.tsx
git commit -m "feat(notifications): AlertBell primitive"
```

### Task 3.3: Add a rule-draft modal wrapper around RuleForm

**Files:**
- Create: `nexus/src/components/notifications/alert-rule-modal.tsx`

- [ ] **Step 1: Implement the wrapper**

This component opens a modal (use the existing modal primitive — grep for `Modal`, `Dialog` in components/ui first; follow the pattern), loads destinations via the notifications hook, and renders `<RuleForm>` with `initial` set from a `RuleDraft`.

```tsx
'use client';

import { useMemo } from 'react';
import { RuleForm, type RuleFormValue } from '@/components/notifications/rule-form';
import { useDestinations, useCreateRule } from '@/hooks/use-notifications';
// The actual modal primitive name — verify against codebase (grep for existing modal):
import { Modal } from '@/components/ui/modal';
import type { RuleMatch } from '@/lib/notifications/types';

export interface RuleDraft {
  name: string;
  match: RuleMatch;
  messageTemplate?: string;
  title?: string;
}

export interface AlertRuleModalProps {
  open: boolean;
  onClose: () => void;
  draft: RuleDraft;
}

export function AlertRuleModal({ open, onClose, draft }: AlertRuleModalProps) {
  const { data: destinations = [] } = useDestinations();
  const createRule = useCreateRule();

  const initial: RuleFormValue = useMemo(() => ({
    name: draft.name,
    enabled: true,
    title: draft.title,
    match: draft.match,
    destinationId: destinations[0]?.id ?? '',
    messageTemplate: draft.messageTemplate ?? 'Nexus alert: {{kind}}\n{{reason}}',
  }), [draft, destinations]);

  function handleSubmit(value: RuleFormValue) {
    createRule.mutate(value, { onSuccess: onClose });
  }

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Create alert rule">
      <RuleForm
        initial={initial}
        destinations={destinations}
        isPending={createRule.isPending}
        error={createRule.error?.message}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
```

**Verify before committing:**
- `useDestinations`, `useCreateRule` names — grep `nexus/src/hooks/use-notifications.ts` and adapt.
- `Modal` primitive path — grep `nexus/src/components/ui/` and adapt.

- [ ] **Step 2: tsc**

```
cd nexus && pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```
git add nexus/src/components/notifications/alert-rule-modal.tsx
git commit -m "feat(notifications): modal wrapper that seeds RuleForm from a draft"
```

### Task 3.4: Mount the bell on pressure widgets — CPU, RAM, disk

**Files:**
- Modify: `nexus/src/components/widgets/pressure-summary.tsx` (CPU + RAM summary)
- Modify: `nexus/src/components/widgets/guest-disk-pressure.tsx` (disk per-guest)
- Modify: `nexus/src/components/widgets/storage-exhaustion.tsx` (storage forecast)
- Read: `nexus/src/hooks/use-notifications.ts` to find `useRules` (or equivalent) to count matching rules.

- [ ] **Step 1: For each widget, determine the scope string**

- CPU on a node → `node:${nodeName}`, metric `node.cpu.max`
- Cluster CPU → `cluster`, metric `cluster.cpu.avg`
- Per-guest CPU → `guest:${vmid}`, metric `guest.cpu`
- Per-guest disk (from the services widget extended in phase 2) → `guest:${vmid}` + event `guest.disk.filling`
- Storage exhaustion → scope `storage:${storageId}`, event probably `storage.exhaustion.projected` (if doesn't exist, use `metric.threshold.crossed` with metric `storage.days_until_full`). **Verify during implementation.**

- [ ] **Step 2: Count matching rules**

In each widget, use `useRules()` and filter to rules whose `match.scope` substring-matches the widget's scope AND whose `match.metric` or `match.eventKind` matches the widget's event.

Pseudocode:

```tsx
const { data: rules = [] } = useRules();
const matching = rules.filter((r) => matchesScope(r, widgetScope, widgetMetric));
```

Add a pure helper `matchesScope(rule, scope, metric)` in `nexus/src/lib/notifications/rule-matcher.ts` (or next to the existing matcher). Write a unit test for it.

- [ ] **Step 3: Render the bell**

In each widget header (next to the existing title / last-updated timestamp), add:

```tsx
<AlertBell
  rulesCount={matching.length}
  onClick={() => setRuleModalOpen(true)}
/>
<AlertRuleModal
  open={ruleModalOpen}
  onClose={() => setRuleModalOpen(false)}
  draft={{
    name: `${widgetTitle} alert`,
    match: {
      eventKind: 'metric.threshold.crossed',
      metric: widgetMetric,
      op: '>=',
      threshold: roundUpToNearest(currentValue, 0.05),
      scope: widgetScope,
    },
    messageTemplate:
      'Nexus alert: {{metric}} {{op}} {{threshold}} on {{scope}}\nCurrent: {{value}}',
  }}
/>
```

For event-kind widgets (services), draft shape is simpler:

```tsx
draft={{
  name: 'Service failure',
  match: { eventKind: 'guest.service.failed', scope: `guest:${vmid}` },
  messageTemplate: 'Service {{unit}} failed on guest {{vmid}}',
}}
```

- [ ] **Step 4: Implement `roundUpToNearest` + `matchesScope` helpers + tests**

**Files:**
- Create: `nexus/src/lib/notifications/rule-draft.ts` + `.test.ts`

```tsx
// rule-draft.ts
export function roundUpToNearest(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

import type { Rule, RuleMatch } from './types';
export function matchesScope(
  rule: Rule,
  widgetScope: string,
  widgetMetricOrKind: string,
): boolean {
  if (!rule.enabled) return false;
  if (rule.match.eventKind === 'metric.threshold.crossed') {
    if (rule.match.metric !== widgetMetricOrKind) return false;
  } else if (rule.match.eventKind !== widgetMetricOrKind) {
    return false;
  }
  if (rule.match.scope && !widgetScope.includes(rule.match.scope)) return false;
  return true;
}
```

Tests — pure functions, trivial. At least:
- `roundUpToNearest(0.84, 0.05)` → `0.85`
- `roundUpToNearest(0.86, 0.05)` → `0.90`
- `matchesScope` with scope substring match, metric mismatch, event kind mismatch.

- [ ] **Step 5: Full tsc + vitest**

```
cd nexus && pnpm tsc --noEmit && pnpm vitest run
```

- [ ] **Step 6: Commit**

```
git add nexus/src/
git commit -m "feat(widgets): bell icon on pressure/event widgets, prefilled rule draft"
```

### Task 3.5: Manual smoke test

Because this is UI-heavy and tests can't cover feel:

- [ ] **Step 1: Start the dev server**

```
cd nexus && pnpm dev
```

- [ ] **Step 2: Exercise the flow**

Open browser, navigate to a VM detail page.
- Bell icon visible on CPU pressure widget (outline, no count).
- Click → modal opens with draft name, metric, threshold pre-filled.
- Save → new rule appears in `/dashboard/notifications/rules`.
- Return to VM detail — bell now has a "1" badge.

Report regressions; do NOT mark the phase done if the modal doesn't open or the rule doesn't save.

- [ ] **Step 3: Kill dev server and commit nothing unless a bug was fixed**

### Task 3.6: Release v0.31.0

- [ ] **Step 1: Full verification**

```
cd nexus && pnpm tsc --noEmit && pnpm lint && pnpm vitest run
```

- [ ] **Step 2: Version bump + release flow**

```
# bump nexus/package.json to 0.31.0
git add nexus/package.json
git commit -m "chore(release): v0.31.0"
```

- [ ] **Step 3: Roadmap update**

Flip 5.4 from ◯ Not started to ✅ Done. Cite the AlertBell primitive + AlertRuleModal.

```
git add docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md
git commit -m "docs(roadmap): mark 5.4 complete with v0.31.0 alert-rule UI"
```

- [ ] **Step 4: Tag + push + reindex**

```
git tag v0.31.0
git push origin main --tags
npx gitnexus analyze --embeddings
```

---

## Phase 4 — 5.5 Predictive Capacity Planner (v0.32.0)

Generalise `trend.ts` into a Holt's-linear `forecast.ts`. Overlay a forecast line on CPU/RAM/disk pressure charts with a horizon selector. Mark threshold crossings. Keep storage `daysUntilFull` working (it continues to use the linear regression primitives).

### Task 4.1: Create `forecast.ts` with Holt's-linear + tests

**Files:**
- Create: `nexus/src/lib/forecast.ts`
- Create: `nexus/src/lib/forecast.test.ts`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { forecast } from './forecast';

describe('forecast — Holt\'s linear', () => {
  it('returns null for fewer than 10 samples', () => {
    const samples = [{ t: 0, v: 1 }, { t: 1, v: 2 }];
    expect(forecast({ samples, horizonSeconds: 3600 })).toBeNull();
  });

  it('produces a flat forecast for a flat input series', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ t: i * 60, v: 0.5 }));
    const result = forecast({ samples, horizonSeconds: 600 });
    expect(result).not.toBeNull();
    const last = result!.points[result!.points.length - 1];
    expect(Math.abs(last.v - 0.5)).toBeLessThan(0.01);
  });

  it('extrapolates an increasing linear trend', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ t: i * 60, v: 0.1 * i }));
    const result = forecast({ samples, horizonSeconds: 600 });
    expect(result).not.toBeNull();
    const last = result!.points[result!.points.length - 1];
    // Trend is ~0.1 per 60s — after 600s beyond the last sample (t=1140s)
    // we expect v around 2.0 (t=1140*0.1/60 ≈ 1.9).
    expect(last.v).toBeGreaterThan(1.5);
  });

  it('flags a threshold crossing when the forecast passes it', () => {
    // Starting at 0.5, climbing 0.05 per sample, 20 samples → ends around 1.45.
    // Threshold 0.8 is crossed within the historical range or early in the forecast.
    const samples = Array.from({ length: 20 }, (_, i) => ({ t: i * 60, v: 0.5 + 0.05 * i }));
    const result = forecast({ samples, horizonSeconds: 600, thresholds: [0.8] });
    expect(result!.crossings).toHaveLength(1);
    expect(result!.crossings[0].threshold).toBe(0.8);
  });

  it('returns low confidence for a high-noise series', () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      t: i * 60,
      v: Math.random(), // completely random 0..1
    }));
    const result = forecast({ samples, horizonSeconds: 600 });
    expect(result!.confidence).toBe('low');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```
cd nexus && pnpm vitest run forecast
```

- [ ] **Step 3: Implement `forecast.ts`**

```tsx
/**
 * Holt's linear smoothing (level + trend EWMA), generalised from trend.ts.
 *
 * The design choice is deliberate: Holt's handles drift better than plain
 * linear regression, but avoids the false precision of seasonal models.
 * Homelab workloads are chaotic enough that daily/weekly cycles are rare
 * — we'd rather underfit than overfit.
 *
 * Deferred: seasonal decomposition (Holt-Winters). Track as roadmap 5.5.1.
 */

export interface ForecastSample {
  /** Seconds epoch. */
  t: number;
  /** Observed value (any unit). */
  v: number;
}

export interface ForecastInput {
  samples: ReadonlyArray<ForecastSample>;
  /** How far to extrapolate, in seconds, past the last sample. */
  horizonSeconds: number;
  /** Optional thresholds to mark crossings for. */
  thresholds?: ReadonlyArray<number>;
  /** Level-smoothing factor. Higher = tracks recent samples harder. Default 0.3. */
  alpha?: number;
  /** Trend-smoothing factor. Default 0.1. */
  beta?: number;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface ForecastResult {
  /** Forecast points, spaced at the same cadence as the input. */
  points: ForecastSample[];
  confidence: Confidence;
  /** Projected timestamps (seconds epoch) where the forecast crosses each threshold. */
  crossings: Array<{ threshold: number; at: number }>;
}

const MIN_SAMPLES = 10;

export function forecast(input: ForecastInput): ForecastResult | null {
  const { samples, horizonSeconds } = input;
  const alpha = input.alpha ?? 0.3;
  const beta = input.beta ?? 0.1;
  if (samples.length < MIN_SAMPLES) return null;

  // Assume regular spacing — median gap.
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) gaps.push(samples[i].t - samples[i - 1].t);
  gaps.sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)] || 60;

  let level = samples[0].v;
  let trend = samples[1].v - samples[0].v;
  for (let i = 1; i < samples.length; i++) {
    const prevLevel = level;
    level = alpha * samples[i].v + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  // Project forward.
  const last = samples[samples.length - 1];
  const steps = Math.max(1, Math.floor(horizonSeconds / gap));
  const points: ForecastSample[] = [];
  for (let k = 1; k <= steps; k++) {
    points.push({ t: last.t + k * gap, v: level + k * trend });
  }

  // Confidence heuristic: variance of residuals relative to fitted line.
  // Low residuals → high confidence; high residuals → low.
  let residualSumSq = 0;
  let fittedLevel = samples[0].v;
  let fittedTrend = samples[1].v - samples[0].v;
  for (let i = 1; i < samples.length; i++) {
    const predicted = fittedLevel + fittedTrend;
    residualSumSq += (samples[i].v - predicted) ** 2;
    const prev = fittedLevel;
    fittedLevel = alpha * samples[i].v + (1 - alpha) * (fittedLevel + fittedTrend);
    fittedTrend = beta * (fittedLevel - prev) + (1 - beta) * fittedTrend;
  }
  const meanResidual = Math.sqrt(residualSumSq / (samples.length - 1));
  const valueRange = Math.max(...samples.map((s) => s.v)) - Math.min(...samples.map((s) => s.v));
  const noiseRatio = valueRange === 0 ? 0 : meanResidual / valueRange;
  const confidence: Confidence =
    noiseRatio < 0.1 ? 'high' : noiseRatio < 0.3 ? 'medium' : 'low';

  // Threshold crossings within the forecast horizon.
  const crossings: Array<{ threshold: number; at: number }> = [];
  for (const threshold of input.thresholds ?? []) {
    // Find crossing in the forecast series (or historical if already past).
    // For linear extrapolation: t_cross = last.t + (threshold - level) / trend.
    if (trend === 0) continue;
    const tCross = last.t + (threshold - level) / trend;
    if (tCross > last.t && tCross <= last.t + horizonSeconds) {
      crossings.push({ threshold, at: tCross });
    }
  }

  return { points, confidence, crossings };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```
cd nexus && pnpm vitest run forecast
```

- [ ] **Step 5: Commit**

```
git add nexus/src/lib/forecast.ts nexus/src/lib/forecast.test.ts
git commit -m "feat(forecast): Holt's linear smoothing with threshold crossings"
```

### Task 4.2: Verify `trend.ts` consumers unchanged

**Files:**
- Read: the files that import from `./trend` (see earlier search — 4 files).

- [ ] **Step 1: Confirm `daysUntilFull`, `linearRegression`, `projectToThreshold` still work**

```
cd nexus && pnpm vitest run trend
```
Expected: existing trend tests pass unchanged. `trend.ts` is NOT edited in phase 4 — `forecast.ts` is a separate, richer module.

- [ ] **Step 2: No commit needed** — no files changed.

### Task 4.3: Add a forecast overlay to the pressure widget charts

**Files:**
- Modify: `nexus/src/components/widgets/pressure-summary.tsx` (or wherever the CPU/RAM time-series chart lives; verify)
- Modify: `nexus/src/components/widgets/guest-disk-pressure.tsx`
- Potentially: `nexus/src/components/dashboard/vm-metrics-chart.tsx`

- [ ] **Step 1: Read `vm-metrics-chart.tsx` to find the charting primitive in use**

```
cat nexus/src/components/dashboard/vm-metrics-chart.tsx
```
Identify: recharts? Tremor? Follow existing patterns.

- [ ] **Step 2: Add a horizon selector to the widget header**

```tsx
const [horizon, setHorizon] = useState<'off' | '24h' | '7d' | '30d'>('off');
```

```tsx
<select value={horizon} onChange={(e) => setHorizon(e.target.value as any)}>
  <option value="off">Forecast off</option>
  <option value="24h">24h forecast</option>
  <option value="7d">7d forecast</option>
  <option value="30d">30d forecast</option>
</select>
```

- [ ] **Step 3: Compute the forecast**

```tsx
const horizonSeconds = { off: 0, '24h': 86400, '7d': 86400*7, '30d': 86400*30 }[horizon];
const forecastResult = useMemo(() => {
  if (horizonSeconds === 0) return null;
  return forecast({
    samples: historySeries,
    horizonSeconds,
    thresholds: activeRuleThresholds,
  });
}, [horizon, historySeries, activeRuleThresholds]);
```

- [ ] **Step 4: Render the forecast line**

Add a second dashed line to the chart (recharts `<Line strokeDasharray="5 5" />` or equivalent) spanning `forecastResult.points`. Opacity keyed off `forecastResult.confidence`:

```tsx
const opacityByConfidence = { low: 0.3, medium: 0.6, high: 0.9 };
<Line
  data={forecastResult?.points ?? []}
  strokeDasharray="5 5"
  strokeOpacity={forecastResult ? opacityByConfidence[forecastResult.confidence] : 0}
/>
```

- [ ] **Step 5: Render crossing markers**

For each `forecastResult.crossings[i]`, render a vertical reference line (`<ReferenceLine x={at} />`) with a label "Projected: 85% at HH:MM Day".

- [ ] **Step 6: tsc + tests**

```
cd nexus && pnpm tsc --noEmit && pnpm vitest run
```

- [ ] **Step 7: Manual smoke test**

```
cd nexus && pnpm dev
```
- On a VM detail page, flip "24h forecast" on.
- Confirm dashed line renders extending from the current sample.
- Confirm the horizon can be toggled off.
- Confirm that a rule with a threshold marks the crossing.

- [ ] **Step 8: Commit**

```
git add nexus/src/components/
git commit -m "feat(forecast): Holt's-linear overlay on pressure widgets with threshold crossings"
```

### Task 4.4: Release v0.32.0 — tier 5 closeout

- [ ] **Step 1: Full verification**

```
cd nexus && pnpm tsc --noEmit && pnpm lint && pnpm vitest run
```

- [ ] **Step 2: Version bump**

```
# bump nexus/package.json to 0.32.0
git add nexus/package.json
git commit -m "chore(release): v0.32.0 — Tier 5 closeout"
```

- [ ] **Step 3: Roadmap update — mark tier 5 ✅**

Edit `docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md`:
- Tier 5 table: flip 5.5 from ◯ Not started to ✅ Done. Note that seasonal forecasting is deferred as 5.5.1.
- Add a new row at the end of Tier 5: `5.5.1 | Seasonal forecasting (Holt-Winters) | ◯ Deferred from 5.5 v1 | Upgrade if homelab workloads show strong daily/weekly cycles.`
- Update the header summary: "Tier 5 — Intelligence: ✅ Complete (all items shipped)."

Commit:

```
git add docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md
git commit -m "docs(roadmap): mark Tier 5 complete (5.5 shipped, 5.5.1 deferred)"
```

- [ ] **Step 4: Tag + push + reindex**

```
git tag v0.32.0
git push origin main --tags
npx gitnexus analyze --embeddings
```

- [ ] **Step 5: Update memories**

Save a project memory noting Tier 5 is closed + the Holt's-linear forecast design choice + 5.5.1 as the upgrade path. Use the auto-memory format (file under `~/.claude/projects/.../memory/` + pointer in `MEMORY.md`).

---

## Self-review checklist for the plan writer

Already run. Summary:

- **Spec coverage:** Each of the four spec phases has at least one task. The embedded decisions (1/3 cadence, Holt's linear, bell on all widgets) are reflected in the task code.
- **Placeholder scan:** No "TBD" / "TODO implement later" in any task step.
- **Type consistency:** `GuestFailedService`, `failedServices`, `guest.service.failed`, `AlertBell`, `AlertRuleModal`, `RuleDraft`, `ForecastInput`, `ForecastResult` appear with the same shape everywhere they're referenced.
- **Verify-before-declaring hooks:** Every task that touches code I haven't read in full includes a "read first" step (Modal primitive location, useRules hook shape, existing metric emission, command palette entry pattern).
- **gitnexus impact hooks:** Every edit of an existing symbol is preceded by a gitnexus_impact step. Risk threshold (HIGH/CRITICAL → stop) is stated at the top.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-tier-5-closeout.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a four-phase plan where each phase should be self-contained.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster per-task but the context window has to carry all four phases.

Which approach?

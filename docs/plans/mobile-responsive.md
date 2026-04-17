# Plan: Mobile-Responsive (Tier 5 — UX)

**Goal:** Nexus renders usably on a phone (375 px viewport). Admin can open it on the go, see cluster health, click into a failing task, reboot a VM. Not a full redesign — just get rid of the mobile-hostile patterns: hardcoded 272 px left padding, fixed `grid-cols-4`, modals that overflow the viewport, and a missing viewport meta.

**Strategy:** Four small phases of targeted edits. Tailwind v4 is already in place (stock breakpoints). The sidebar becomes a drawer below `lg` (<1024 px), grids get `grid-cols-1 sm:grid-cols-N` fallbacks, and every modal gets a `w-full max-w-none sm:max-w-*` pattern so it becomes fullscreen on phones. No new libraries.

---

## Phase 0 — Documentation Discovery (COMPLETE)

### Key facts from discovery

- **Stock Tailwind v4 breakpoints** via `@theme` in `globals.css`. `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`. Convention in the existing code: prefer `sm:` and `lg:`, rarely `md:`.
- **Root layout** hardcodes `<main className="pl-[272px] pr-4 py-4 min-h-screen">` — reserves the sidebar's space on every viewport. Must become responsive.
- **Sidebar** is `fixed top-4 left-4 bottom-4 z-40 w-60 liquid-glass` — no toggle, no collapse, no mobile story. Phase 1 adds the drawer behaviour.
- **No `<meta name="viewport">`** in the root layout. Without this mobile browsers render at ~980 px and shrink the whole UI to 40 % scale. **This is the single highest-leverage fix in the plan.**
- **Mobile-hostile grids** (fixed `grid-cols-N` without a `sm:` fallback), prioritised by severity:
  - `grid-cols-4` on dashboard summary stats (line 143 of `dashboard/page.tsx`)
  - `grid-cols-3` on scheduled-jobs summary (line 102 of `dashboard/schedules/page.tsx`)
  - `grid-cols-[280px_1fr]` sidebars on dashboard (161), nodes (41), cluster/pools (95), system/network (320)
  - `grid-cols-2` on form fields in cts/create, vms/create, network, firewall rule editor
- **Modals** universally use `studio-card p-6 w-full max-w-lg` (or wider). The `w-full` already scales on small screens — but the outer `max-w-lg` caps at 512 px, which is fine. The real issue: the `fixed inset-0 ... py-8` scrim gives them a gutter on phones, and the nested `max-w-2xl`/`max-w-5xl` modals (tasks correlation drawer, clone wizard, migrate wizard) have explicit sizes that still fit but waste vertical space. Phase 2 makes them fullscreen-on-mobile.
- **TabBar** uses `flex gap-1` with `whitespace-nowrap` — on narrow viewports tabs overflow with no scroll affordance. Phase 3 wraps in `overflow-x-auto`.
- **Good responsive patterns already exist** (e.g., `grid-cols-2 xl:grid-cols-4` on health, `flex flex-col lg:flex-row` on scripts). We copy those.

### Anti-patterns (do NOT do these)

- Do NOT rewrite pages. Target the specific class strings that break, leave the rest.
- Do NOT hide content on mobile — everything should still be reachable. Only the layout changes.
- Do NOT introduce a second root layout for mobile. One responsive layout, breakpoint-driven.
- Do NOT add a mobile-detection JS library. CSS media queries + a single drawer-state `useState` is enough.
- Do NOT change the TabBar's tab order or pill styling. The fix is purely overflow-x-auto on the container.
- Do NOT touch `globals.css` except to add the `:root` / animation tweaks that are specifically mobile-related. The existing custom utilities (studio-card, liquid-glass) already work on any viewport.

### Allowed APIs (reuse these)

| Concern | Pattern to copy | Example callsite |
|---|---|---|
| Fullscreen modal on mobile | `w-full h-full max-w-none rounded-none sm:w-full sm:h-auto sm:max-w-lg sm:rounded-lg` | new in this plan |
| Stat grid breakpoints | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` | health/page.tsx already uses this |
| Two-pane collapse | `grid-cols-1 lg:grid-cols-[280px_1fr]` | invent — consistent with scripts page's `flex-col lg:flex-row` |
| Hamburger | Lucide `Menu` + `X` | unused today; icon library already present |
| Overlay scrim | `fixed inset-0 bg-black/60 z-30 lg:hidden` | same language as every modal |

---

## Phase 1 — Chrome: viewport meta + responsive sidebar

**What to implement**

1. **Viewport meta** in the root layout (`nexus/src/app/layout.tsx`). Next.js 16 prefers the `export const viewport = { ... }` metadata export:
   ```ts
   export const viewport: Viewport = {
     width: 'device-width',
     initialScale: 1,
     viewportFit: 'cover', // respect iOS safe-area insets
   };
   ```
   This single line is responsible for ~80 % of the mobile experience improvement.

2. **Sidebar drawer behaviour** in `components/dashboard/sidebar.tsx`:
   - Accept an optional `open: boolean; onClose: () => void` pair via props.
   - On small screens (`< lg`): hide by default, slide in from the left when `open`. An overlay scrim closes it on tap. Classes: `fixed lg:static ... -translate-x-full lg:translate-x-0 transition-transform`.
   - On `lg` and up: current behaviour — always visible in the liquid-glass rail.
   - Clicking any nav link calls `onClose` so the drawer closes after navigation.

3. **Hamburger button** in the app layout (`(app)/layout.tsx`):
   - New `<button>` at the top-left (fixed position, `lg:hidden`) that toggles the drawer state.
   - Icon: Lucide `Menu` when closed, `X` when open.
   - Lives in a tiny client-component wrapper `AppShell` that owns the drawer's `useState` — rest of the layout stays server-rendered.

4. **Main content padding**:
   - Change `<main className="pl-[272px] pr-4 py-4 min-h-screen">` to
     `<main className="px-4 py-4 min-h-screen lg:pl-[272px] lg:pr-4">`.
   - Now reserves the sidebar gutter only at `lg+`.

**Documentation references**

- Current root layout: `nexus/src/app/layout.tsx`
- Current app shell: `nexus/src/app/(app)/layout.tsx`
- Sidebar: `components/dashboard/sidebar.tsx`
- Next.js 16 viewport metadata: docs/plans/mobile-responsive.md#key-facts (see above)

**Verification**

- `npx tsc --noEmit` clean
- Dev server in Chrome DevTools @ 375 × 812 (iPhone 13): sidebar hidden, hamburger visible, content fills the width with no horizontal scroll
- Desktop ≥ 1024 px: sidebar present at all times, hamburger hidden
- Tap a nav link on mobile — drawer closes, new page renders

**Anti-pattern guards**

- Do NOT render the hamburger above `lg` — trips muscle memory for keyboard users.
- Do NOT use `position: fixed` in the hamburger placement on desktop; keep it in-flow.

---

## Phase 2 — Modal fullscreen-on-mobile

**What to implement**

1. **Shared modal shell helper** at `components/ui/modal-shell.tsx`:
   ```tsx
   export function ModalShell({
     children,
     size = 'md',
     onClose,
   }: {
     children: React.ReactNode;
     size?: 'md' | 'lg' | '2xl' | '5xl';
     onClose: () => void;
   }) { /* … */ }
   ```
   Outer: `fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 sm:py-8 overflow-y-auto`.
   Inner card: `studio-card w-full h-full sm:h-auto sm:max-w-${size} sm:rounded-lg p-4 sm:p-6`.
   Optional `onClose` supplies an outside-click and ESC handler.

2. **Migrate the five hottest modals** to `ModalShell`:
   - `components/migrate/migrate-wizard.tsx`
   - `components/clone/clone-wizard.tsx`
   - `components/scripts/schedule-job-editor.tsx`
   - `components/backups/backup-job-editor.tsx`
   - `components/tasks/task-correlation-drawer.tsx`
   Keep every other modal untouched — they're less common and inherit the same class-string pattern; Phase 3's audit covers them with direct edits.

3. **Direct class-string edits** for the less-central modals (access tabs, storage dialogs, iso upload, map storage, file browser sheet, job drawer, confirm dialog): replace the outer `max-w-md` → `w-full sm:max-w-md` and the wrapper `py-8` → `sm:py-8`. No behavioural change; just makes them fill the viewport on phones.

**Verification**

- `npm test` still 104 passing (no test code affected)
- `tsc --noEmit` clean
- Dev @ 375 px: open Migrate wizard from a VM — takes the full screen, content scrolls if it overflows, the Back/Next row stays reachable at the bottom
- Dev @ 1024 px: same wizard still sits centred at `max-w-2xl`

**Anti-pattern guards**

- Do NOT insert a bottom-sheet slide-in animation. It's tempting but the existing fade-in works fine and adds motion-safe complexity we don't need.
- Do NOT convert every modal in the repo to the helper. The helper exists to eliminate duplication for the five highest-traffic wizards; the rest stay on ad-hoc class strings.

---

## Phase 3 — Grid + TabBar mobile audit

**What to implement**

1. **Critical grid fallbacks** (find/replace):
   | File | Line | Old | New |
   |---|---|---|---|
   | `dashboard/page.tsx` | ~143 | `grid grid-cols-4 gap-3` | `grid grid-cols-2 xl:grid-cols-4 gap-3` |
   | `dashboard/page.tsx` | ~161 | `grid grid-cols-[280px_1fr] gap-4` | `grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4` |
   | `dashboard/nodes/page.tsx` | ~41 | `grid grid-cols-[280px_1fr]` | `grid grid-cols-1 lg:grid-cols-[280px_1fr]` |
   | `dashboard/cluster/pools/page.tsx` | ~95 | `grid grid-cols-[280px_1fr]` | `grid grid-cols-1 lg:grid-cols-[280px_1fr]` |
   | `dashboard/system/network/page.tsx` | ~320 | `grid grid-cols-[260px_1fr]` | `grid grid-cols-1 lg:grid-cols-[260px_1fr]` |
   | `dashboard/schedules/page.tsx` | ~102 | `grid grid-cols-3 gap-3` | `grid grid-cols-1 sm:grid-cols-3 gap-3` |
   | `components/firewall/rule-editor.tsx` | ~110 | `grid grid-cols-3` | `grid grid-cols-1 sm:grid-cols-3` |

2. **Form grids** (the 2-col patterns on create flows):
   - `cts/create/page.tsx` and `vms/create/page.tsx` — `grid grid-cols-2` in hardware/network sections → `grid grid-cols-1 sm:grid-cols-2`
   - `dashboard/system/network/page.tsx` 2-col field rows → same
   Only change fields whose individual inputs become < 150 px on a phone. Gauges and icon-label pairs can stay 2-col.

3. **TabBar horizontal overflow** in `components/dashboard/tab-bar.tsx`:
   - Wrap the existing `<div className="flex gap-1 ...">` with `overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0` so the tab row can scroll independently of the page and the bleed edge feels natural on mobile.
   - No change to the tab buttons themselves.

4. **JobStatusBar** (`components/script-jobs/JobStatusBar.tsx`) — already has `max-w-[calc(100vw-2rem)]`; confirm it sits above the bottom safe-area on iOS by adding `bottom-[max(1rem,env(safe-area-inset-bottom))]`.

5. **Toast min-width**: `components/ui/toast.tsx` has `min-w-72`. On 375 px that's ~77 % of viewport. Change to `min-w-56 sm:min-w-72`.

**Verification**

- Build still green
- Dev @ 375 px:
  - Dashboard Overview: 2 summary cards per row (not 4 crammed)
  - Scheduler Overview: 1 per row
  - Any page with a ResourceTree rail: tree stacks above content
  - VM detail: tab bar scrolls left/right with a thumb
- Dev @ 1024 px: Dashboard Overview is still 4 cards (the `xl:grid-cols-4` kicks in)

**Anti-pattern guards**

- Do NOT wrap the tab bar contents — scrolling is better than wrapping for tab affordances.
- Do NOT touch pages already carrying `grid-cols-1 sm:grid-cols-N` (they're fine).

---

## Phase 4 — Verification

**Checks**

1. **Type + lint gate**: `tsc --noEmit` clean; `next lint` clean on edited files.
2. **Tests**: `npm test` — still 104 passing (nothing here is unit-testable, this phase is CSS).
3. **Anti-pattern greps**
   - `rg 'pl-\[272px\]' nexus/src/app/\(app\)/layout.tsx` → zero (main padding must be behind `lg:`)
   - `rg 'grid-cols-4\b' nexus/src/app/\(app\)/dashboard/page.tsx` → zero (must be `grid-cols-2 xl:grid-cols-4`)
   - `rg 'grid-cols-\[280px_1fr\]' nexus/src/app` → only occurrences inside a `lg:` prefix
   - `rg 'viewport' nexus/src/app/layout.tsx` → at least one match
4. **Manual smoke matrix** (Chrome DevTools device toolbar):
   | Viewport | Expected |
   |---|---|
   | 375 × 812 (iPhone 13) | No horizontal scroll anywhere; sidebar behind hamburger; grids stacked; modals fullscreen |
   | 768 × 1024 (iPad portrait) | Sidebar hidden under hamburger (still `< lg`); grids 2-col where appropriate |
   | 1024 × 768 (iPad landscape) | Sidebar visible; grids at normal density |
   | 1920 × 1080 (desktop) | Zero regression vs. current main |
5. **Functional flows on mobile**: login → dashboard → pick a failed task → correlation drawer opens fullscreen → close drawer → VM detail page → hit Reboot. Every step reachable with one thumb.

**Exit criteria**

- Plan's smoke matrix passes
- No regression on any desktop page
- The existing Chrome DevTools Lighthouse score for "Mobile" doesn't drop (it's low today; we just need not to make it worse)

---

## Commit boundaries

- Phase 1 → one commit (viewport + sidebar + main-padding unlock)
- Phase 2 → one commit (modal shell helper + five wizard migrations + class edits on the rest)
- Phase 3 → one commit (grid audit + TabBar overflow + safe-area inset + toast min-width)
- Phase 4 → verification-only commit with smoke-matrix notes

No CI changes. Everything is in the Next.js bundle — `server.ts` graph untouched.

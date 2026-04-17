# Bento Dashboard — 4 curated presets

## Goal
Replace the single `/dashboard` view with a segmented switcher over four
curated bento-grid presets so operators land on the right pane of glass
without drag-and-drop complexity.

## Presets
| id          | label      | audience                         |
|-------------|------------|----------------------------------|
| `overview`  | Overview   | Daily landing page (default).    |
| `noc`       | NOC        | Active monitoring / oncall.      |
| `capacity`  | Capacity   | Planning, headroom, projections. |
| `incidents` | Incidents  | Active firefighting.             |

## Persistence
Cookie `nexus.dashboard.preset` (browser-scoped). 20 LOC; upgrade to
server-side if multi-browser users complain.

## Architecture
```
src/lib/widgets/
  registry.ts       Widget type (id, title, span hints, Component)
  presets.ts        4 BentoPreset objects — layout arrays keyed by widget id
src/components/dashboard/
  bento-grid.tsx    CSS-grid renderer; takes a preset and looks widgets up
  preset-switcher.tsx  Segmented pill control + cookie write
src/components/widgets/
  <one file per widget>  Self-fetching, its own loading/error states
src/hooks/
  use-preferred-preset.ts   Cookie-backed getter/setter
```

## Phase boundaries (one commit each)

1. **Foundation.** Widget type + preset type + BentoGrid + cookie hook +
   presets.ts skeleton with no widgets registered. Unit test for preset
   shape + layout collision detection.
2. **Widget extraction.** Build/refactor atomic widget components.
   Each one owns its fetching and visual states. No preset wiring yet.
3. **Preset layouts.** Populate the four preset layout arrays with
   extracted widgets. This is where the feature feels real.
4. **Dashboard integration.** `/dashboard/page.tsx` becomes a switcher
   + `<BentoGrid preset={…}>` instead of today's bespoke layout.
5. **Verification.** tsc / lint / tests. Anti-pattern greps: no
   react-grid-layout / react-dnd imports (keep bento static), no
   preset-level state leakage, no cross-widget prop drilling.

## Widgets required (Phase 2 roster)
- `ClusterSummary` — the 4-tile Nodes/VMs/CTs/Total stats row
- `NodeRoster` — NodeCard grid (read-only variant, no selection state)
- `StoragePressure` — per-datastore fill + trend pip
- `RecentTasks` — last-24h task feed
- `FailedTasksFeed` — NOC preset: failed + error-level tasks only
- `HaHealth` — HA manager + resource state
- `NodeCpuRamMini` — compact CPU/RAM gauges across every node
- `CapacityProjections` — storage fill ETA, RAM over-commit ratio
- `GuestTroubleList` — VMs/CTs with status ≠ running (incidents)
- `BackupHealth` — last backup success/failure per guest
- `SubscriptionExpiry` — per-node sub state + cert expiry

## Anti-pattern guards
- No new DnD / grid-layout libraries; the grid is plain CSS.
- Widgets never import each other. Each is fetch-and-render; layout
  arrangement is the preset's job.
- No server-side state for presets in Phase 1-5. Cookie only.

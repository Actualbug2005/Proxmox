# Tier 5 Closeout — Design

**Date:** 2026-04-19
**Scope:** Finish Tier 5 (Intelligence) of the Nexus roadmap as a single coherent workstream, shipped in four phases with a release per phase.
**Supersedes (for Tier 5):** `2026-04-19-nexus-roadmap-update.md` items 5.2, 5.4, 5.5.

## Why one design, four releases

Tier 5 is "Intelligence" — the pressure widgets, the rule engine, the forecast. All three remaining items (5.2 services probes, 5.4 alert-rule UI on pressure widgets, 5.5 predictive capacity planner) **converge on the same UI surface**: pressure widgets. Designing them separately risks repainting the widget UX three times. One design, phased implementation, release-per-phase keeps momentum without coupling commits.

Phase 1 (service-account nav) is a discoverability bug-fix that rides along: the service account gates *every* Tier 5 feature (DRS, notifications poll, guest-agent probes) so the discoverability trap is in-scope.

## Phased plan at a glance

| Phase | Scope | Target release |
|---|---|---|
| 1 | Service-account nav entry + Command Palette entry | v0.29.0 |
| 2 | 5.2 services-level probes + notification event | v0.30.0 |
| 3 | 5.4 alert-rule UI on pressure widgets (bell icon → prefilled editor) | v0.31.0 |
| 4 | 5.5 predictive capacity planner (EWMA / Holt's linear on CPU/RAM/disk) | v0.32.0 |

Each phase: tests pass, tsc/lint clean, release cut, push, update roadmap inline.

---

## Phase 1 — Service-account discoverability

### Problem

`nexus/src/components/dashboard/service-account-banner.tsx` sets
`sessionStorage['nexus:service-account-banner-dismissed'] = '1'` on dismiss.
Once dismissed there is no other entry point to `/dashboard/system/service-account`
in the UI — not in the sidebar, not in the command palette, not linked anywhere
else. A user who dismisses the banner mid-setup or by accident has to type the
URL manually.

### Change

1. **Sidebar.** Add entry to the `System` section of
   `nexus/src/components/dashboard/sidebar.tsx`:
   ```
   { href: '/dashboard/system/service-account', label: 'Service Account', icon: KeyRound }
   ```
   Placement: after `Users & ACL`, before `Audit Log`. Rationale: both access-
   domain; Audit Log follows auth conceptually.
2. **Command palette.** Add a nav-group entry for the same page. Verify existing
   palette nav-source pattern and append there rather than hand-rolling a new
   command.
3. **Banner.** No code change to dismiss behaviour. The banner remains the
   high-visibility nag for fresh installs; sidebar entry is the permanent home.

### Out of scope

- Banner TTL / re-appearance logic (not needed once sidebar is the canonical home).
- Changing banner dismiss storage from sessionStorage to localStorage (current
  behaviour is fine).
- Service-account health indicator in nav (future work; track if operators ask).

### Tests

- `sidebar.test.tsx` — assert new item renders in `System` section and the link
  resolves to the correct href.
- Command-palette test: new entry appears in navigation search for query
  `"service account"`.

### Risk / blast radius

Trivially low. One added nav item, one palette entry. No existing callers.

---

## Phase 2 — 5.2 services-level guest probes

### Goal

Extend guest-internal health from `{ diskPressure, agentLive }` to
`{ diskPressure, agentLive, failedServices }`. Emit a notification event when
the failed-services set transitions from empty → non-empty for a guest.

### Probe

- **Transport.** Existing `qm guest exec` (VMs) / `pct exec` (CTs) path. Same
  code path as current agent-exec probes.
- **Command.** `systemctl list-units --state=failed --no-legend --plain --no-pager`
  — one call, one guest, one poll. Output is stable: `<unit> <load> <active> <sub> <description>`.
- **Parse.** Pure function in a new module (`services-probe.ts`) that takes raw
  stdout and returns `{ unit: string; description: string }[]`. Timestamps
  (`since`) come from the probe's walltime when we first observed the unit in
  the failed set, persisted alongside the guest-health row.
- **Cadence.** 1/3 of the main pressure-probe cadence. Pressure polls at the
  configured `POLL_INTERVALS.guestPressure` (typically 15s); services polls at
  roughly 45s. Implementation detail: a per-guest counter in the probe loop
  `if (tick % 3 === 0) probeServices(guest)`, not a second scheduler.
- **On-demand.** "Refresh services" button on the guest detail card triggers
  an immediate probe outside the tick counter.

### Storage

The guest-health store already persists per-guest rows; add a `failedServices`
column (JSON blob) and a `firstObservedAt` map keyed by unit name. No migration
churn — this store is rebuilt from live probes on service restart, so adding a
column is an in-place schema bump.

### Event emission

New notification event source: `guest.service.failed`.
- Fires when the diff of two successive probes shows a unit present now and
  absent in the previous sample.
- Payload: `{ guestId, guestName, nodeId, unit, description, since }`.
- Resolve emission: when the unit disappears from the failed set, emit a
  resolve event consumed by the rule engine's existing resolved-flag
  plumbing (v0.27.3).

### UI

- **Guest-health widget.** New row under the disk-pressure row: "Failed
  services: N" with expand-on-click showing unit names + since-timestamps.
  Zero-state: omit the row entirely when `N === 0`.
- **VM / CT detail page.** New "Failed services" card alongside existing
  pressure cards. Same list + "Refresh" button.

### Opt-out

Per-guest toggle in guest settings (`Services probes: on/off`). Default on.
Rationale: services-probing is marginally more invasive than disk-pressure
(enumerates unit names), so give operators the off-switch even though it's
not expected to be used often. Setting lives with the existing guest-agent
toggle, not as a separate settings page.

### Tests

- Parser unit tests: empty output, single unit, many units, unicode
  descriptions, trailing whitespace. Table-driven.
- Probe cadence test: mock scheduler, assert services probe runs at tick 0, 3, 6.
- Event-emission test: transition empty → `[{unit:"nginx.service"}]` emits one
  `guest.service.failed` event with correct payload; staying in that state does
  NOT re-emit.
- Resolve test: transition back to empty emits a resolved event.

### Risk / blast radius

Medium. Touches the probe loop, which is hot-path code. Mitigations:
- Ship on by default; rely on per-guest opt-out as the escape hatch (no env flag
  — ceremony for a local toggle that already exists).
- `gitnexus_impact` on the probe-loop function before edit; bail to a smaller
  surface if blast radius warns HIGH/CRITICAL.

---

## Phase 3 — 5.4 Alert-rule UI on pressure widgets

### Goal

Bell icon on every pressure widget (CPU, RAM, disk, services, agent). Click →
prefilled rule editor. Save → rule appears in existing notifications page.

### Entry point

`PressureWidget` (or whatever the component is called — to verify during
implementation) renders a small bell icon in its header. States:
- `no rules targeting this source` → outline bell, click opens editor empty-ish.
- `≥1 active rule targeting this source` → filled bell with badge showing count;
  click opens a small popover listing those rules + "Add another" + quick
  jump to the rule detail.

### Prefill mechanism

Widget holds enough context to construct a rule draft:
```ts
type RuleDraft = {
  sourceType: 'threshold' | 'event';
  source: string; // e.g. 'pressure.cpu', 'guest.service.failed'
  scope: { guestId?: string; nodeId?: string; cluster?: true };
  // Only for threshold mode:
  operator?: '>' | '>=' | '<' | '<=';
  threshold?: number;
  durationSeconds?: number;
};
```
Widget passes a `RuleDraft` to the editor via props (modal open callback). The
editor already accepts an optional draft — verify during implementation; if it
doesn't, add the prop and backfill.

### Threshold prefill

Round the current widget value up to the nearest sensible unit. For percentages,
round up to the next 5 (84% → 85, 91% → 95). For absolute byte values, round up
to the next GB. Always `operator: '>='`. Default `durationSeconds: 300` (5 min)
so transient spikes don't fire.

### Event mode prefill

For services / agent widgets, no threshold. Source is `guest.service.failed` or
`guest.agent.down`. Scope defaults to the current guest only. Operator and
threshold fields are hidden in the editor.

### New event sources to ensure exist

Before writing the editor changes, verify or add to the rule-engine event taxonomy:
- `pressure.cpu.high` (threshold)
- `pressure.ram.high` (threshold)
- `pressure.disk.high` (threshold)
- `guest.service.failed` (event) — added in phase 2
- `guest.agent.down` (event) — likely exists; verify

### Rule lifecycle

Nothing new — uses the existing rule engine, destinations, dispatch path,
resolve handling (v0.27.3), and per-rule resolve template (v0.28.0). Phase 3
is pure UI wiring + a couple of new source strings.

### UI

- Modal (or slide-over — match existing rule-editor UX; verify).
- Title: `Alert when <guest/node> <source> <op> <threshold>` pre-filled.
- Destination dropdown: existing transports.
- Save button + Cancel.

### Tests

- Component test: click bell → modal opens with prefill values matching the
  widget's current state.
- Rule-round-trip test: submit prefill → rule appears in rules list with
  expected fields.
- Event-mode test: services widget bell opens editor with event mode, no
  threshold inputs visible.

### Risk / blast radius

Low. New UI on top of an existing stable engine. No schema changes.

---

## Phase 4 — 5.5 Predictive Capacity Planner

### Goal

Extend `trend.ts` from storage-only to CPU/RAM/disk. Forecast line on pressure
widgets with a user-configurable horizon (24h / 7d / 30d). Mark where the
forecast line crosses a threshold.

### Algorithm

**Holt's linear (EWMA with trend).** Captures both level and drift without the
false confidence of seasonal decomposition. Pseudocode:

```
level_t = α * x_t + (1 - α) * (level_{t-1} + trend_{t-1})
trend_t = β * (level_t - level_{t-1}) + (1 - β) * trend_{t-1}
forecast_{t+k} = level_t + k * trend_t
```

Defaults: `α = 0.3`, `β = 0.1`. Tuned for homelab workloads (noisy, chaotic,
low autocorrelation). Expose as constants, not runtime settings.

Degenerate cases:
- `< 10 samples` → no forecast, show "Insufficient history".
- Flat line (zero variance) → forecast is flat, no crossing marker.
- Negative trend (usage dropping) → forecast line shown but no crossing marker.

### Producers

No new collection. Metrics already flow through the pressure store. Forecast
reads the last N samples (configurable, default 288 = 24h at 5-min resolution
or equivalent at the actual sample rate) and returns a forecast series
extending `horizon` samples into the future.

### Module shape

```ts
// nexus/src/lib/forecast.ts (new, generalised from trend.ts)
export interface ForecastInput {
  samples: { t: number; v: number }[];
  horizonSeconds: number;
  alpha?: number;
  beta?: number;
}
export interface ForecastResult {
  points: { t: number; v: number }[];
  confidence: 'low' | 'medium' | 'high'; // heuristic based on noise
  crossings: { threshold: number; at: number }[];
}
export function forecast(input: ForecastInput): ForecastResult | null;
```

`trend.ts` (storage) refactors to call `forecast.ts`. Verify there are no other
consumers of `trend.ts` before changing its surface.

### UI

- **Widget-level toggle.** Small horizon selector in the widget header: "24h / 7d / 30d / off". Default off on first ship — opt-in, so existing widgets don't change overnight.
- **Chart overlay.** Dashed line from last sample extending `horizon` into the future. Different colour / lower opacity than the historical line. Label at the end ("Projected: 91%").
- **Crossing marker.** If the widget has an active alert rule with threshold T and the forecast crosses T, show a vertical rule at the crossing timestamp with a tooltip: "Projected to cross 85% at 14:32 Thu".
- **Confidence treatment.** Forecast line opacity varies with `confidence`:
  low → 30%, medium → 60%, high → 90%. Keeps the user honest.

### Tests

- Holt's-linear unit tests: known input series, assert forecast values to 4
  decimals.
- Edge cases: < 10 samples returns null, flat line returns flat, negative
  trend returns no crossings.
- Confidence heuristic test: low-noise input → `high`, high-noise input → `low`.

### Risk / blast radius

Low. New module + one widget UI addition + refactor of `trend.ts`. Existing
storage forecast must keep working — regression test before/after refactor.

### Future upgrade note

Seasonal forecasting (detect daily / weekly cycles — Holt-Winters or STL) is
**explicitly deferred**. Triggers for revisiting: operators running production-
shaped workloads on Nexus (business-hours CPU patterns, nightly backup spikes)
ask for it, or the simple model produces visibly wrong forecasts in dashboards.
Add as roadmap item "5.5.1 Seasonal forecast" with status `◯ Not started,
deferred from 5.5 v1`.

---

## Cross-phase invariants

- **Testing.** Every phase lands with tests green (tsc + lint + vitest).
  Verification before claiming done per `superpowers:verification-before-completion`.
- **Release discipline.** After each phase: commit → tag `v0.2X.0` → push → CI
  publishes. No confirmation prompt (per standing order).
- **Roadmap updates.** After each phase ships, update
  `docs/superpowers/specs/2026-04-19-nexus-roadmap-update.md` inline so the
  next session sees the current state without re-auditing the tree.
- **Memory updates.** Only when something non-obvious / surprising emerges
  (matching "auto memory" guidance).
- **gitnexus discipline.** `gitnexus_impact` before editing any symbol in the
  probe loop, rule engine dispatch, or trend module. `gitnexus_detect_changes`
  before every commit.

## Open items to resolve during implementation (not during spec approval)

- Exact prop shape of existing rule editor (does it accept a draft already?).
- Exact name of the pressure-widget component + how it's instanced per guest.
- Whether `guest.agent.down` event source already exists.
- Number of consumers of `trend.ts` (if only the storage widget, refactor is
  free; if more, we need a migration pass).

These are "verify in code, decide inline" — not design questions.

## Rollout

Releases land on `main` directly (no feature branches for phases — each phase
is small enough). If any phase exposes bugs post-release, fix-forward in the
next patch release.

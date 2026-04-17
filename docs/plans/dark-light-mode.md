# Dynamic Glass — dark / light / system theming

## Goal
Ship full dark + light parity across every page in Nexus. Users can
pick **Dark**, **Light**, or **System** (follows OS `prefers-color-scheme`).
Persistence via `next-themes` (cookie + localStorage, SSR-safe, no FOUC).

## Scope (Option A — full parity)
- 98 files reference `zinc-*` / `slate-*` / `gray-*` classes today.
- 75 files use `.studio-card`; rewriting the class alone fixes these.
- 2 files use `.liquid-glass`; same.
- Severity colours (emerald/amber/red) need per-theme luminance tuning.

## Architecture
```
globals.css
  @theme                       — shared tokens (type scale, radius, font)
  [data-theme="dark"]  { ... } — default palette
  [data-theme="light"] { ... } — light palette
  body + .studio-card + .liquid-glass rewritten to use semantic tokens

src/lib/theme/
  (no code here — next-themes does the lifting)

src/hooks/
  use-theme.ts                 — thin wrapper over next-themes for typed API

src/components/dashboard/
  theme-toggle.tsx             — sidebar toggle: Sun / Moon / Monitor tri-state
```

## Token set (both themes)
| Token                  | Role                                             |
|------------------------|--------------------------------------------------|
| --color-canvas         | Body background fill                             |
| --color-canvas-glow    | Radial gradient tint on body                     |
| --color-surface        | Solid card fill (elevated / modals)              |
| --color-surface-glass  | Translucent card fill (studio-card)              |
| --color-chrome-glass   | Translucent chrome fill (liquid-glass / sidebar) |
| --color-overlay        | Hover / focus fill                               |
| --color-border-subtle  | Hairline borders                                 |
| --color-border-strong  | Focus / selection borders                        |
| --color-fg             | Primary text                                     |
| --color-fg-secondary   | Secondary text                                   |
| --color-fg-muted       | Meta, timestamps                                 |
| --color-fg-subtle      | Placeholder, disabled                            |
| --color-accent         | Brand (indigo)                                   |
| --color-ok             | Success (emerald, per-theme tuned)               |
| --color-warn           | Warning (amber, per-theme tuned)                 |
| --color-err            | Error (red, per-theme tuned)                     |

## Phases (one commit each)

1. **Infrastructure.** Install `next-themes`. Add `ThemeProvider` to the
   (app) layout with `attribute="data-theme"` and `defaultTheme="system"`.
   Theme toggle in the sidebar user row. Typed `useTheme` wrapper so
   consumers get an enum, not `string | undefined`.

2. **Token scaffold.** Rewrite `globals.css` with the token set above,
   keyed under `[data-theme="dark"]` and `[data-theme="light"]`. Update
   `studio-card`, `liquid-glass`, body background, and scrollbar to read
   from tokens. Validates by toggling at runtime: chrome + card materials
   should flip cleanly.

3. **UI primitive sweep.** Badge, Button, ProgressBar, StatusDot, Gauge,
   Input, Select, Dropdown, Empty state, Toast, Confirm dialog. These
   are used on every page, so fixing them in one pass cascades.

4. **Page sweep.** Mechanical find-and-replace of literal `zinc-*` in
   page bodies. Prefer tokens where semantic; keep literal values where
   the design genuinely calls for a specific tone (e.g. severity badges
   already tuned). ~60 files.

5. **Verification.** tsc / lint / tests. Contrast spot-check (WCAG AA
   on fg-on-canvas, fg-on-surface). Manual QA matrix: dashboard + nodes +
   chains + schedules + login, each in dark/light/system.

## Anti-pattern guards
- No `@media (prefers-color-scheme: ...)` outside `globals.css`.
  Components read tokens; the cascade handles the switch.
- No new `className="text-black"` or `text-white` — if it was hardcoded
  before, prefer a token (or if truly context-specific, leave it).
- No inline `style={{ color: ... }}` added during the sweep; tokens only.
- Sidebar / modal / body blurring stays GPU-cheap (no new backdrop-filter
  layers beyond what Phase 2 defines).

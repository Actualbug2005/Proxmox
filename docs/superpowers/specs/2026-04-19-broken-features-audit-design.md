# Broken / Limited Features — Static Audit + Fix Sweep

**Date:** 2026-04-19
**Status:** Approved for implementation

## Problem

Manual UI/UX testing of Nexus has surfaced shipped features that either do not work or have limited functionality. The set of broken features is not enumerated — it needs to be discovered. A real Proxmox host is not available for runtime probing, so detection must be static (code-level).

## Goal

Sweep the whole `nexus/src` tree, identify features that are broken or only partially wired, and fix them in place. Fix as we find.

## Scope

### In scope (what counts as a defect)

- Runtime failures: handlers that throw, routes that 500, code paths that silently return empty/undefined where a value is expected.
- Dead UI wiring: `onClick={() => {}}`, submit handlers that don't call their mutation, buttons with no handler, forms whose submit swallows the response.
- Half-wired seams: mutations that never invalidate their query; `useState` setters that are never called; API routes with no UI consumer; UI that calls an API route that doesn't exist.
- Explicit unfinished markers: `TODO`, `FIXME`, `XXX`, `@ts-expect-error`, `@ts-ignore`, `throw new Error('not implemented'|'TODO')`, `return ... 501`, stub `console.warn`s, mock data in non-test paths.
- Shape mismatches: UI reads a field the API doesn't return; API returns a field nothing reads; zod schema drift vs TypeScript types; optional-chaining hiding a permanently-missing field.

### Out of scope

- Polish (loading states, empty states, toast coverage, confirmation dialogs, visual bugs).
- New features or refactors not required for a specific fix.
- Dependency upgrades.
- Test additions unless a fix directly requires one.
- Comments and docstrings.
- Running the app or exercising features live.
- Anything under `docs/`, `deploy/`, `install.sh`.

### Skip list (touch only if directly blocking a fix, and report first)

- Auth / CSRF internals — `PVEAuthSession` brands, session shape, ticket handling. Recently stabilised (0.9.x), high-risk.
- noVNC / xterm integration — requires runtime to verify behaviour.
- Anything the stop conditions below cover.

## Method

Four detection passes over `nexus/src`:

1. **Dead handlers.** Grep for empty arrow handlers, buttons without `onClick`, disabled-forever controls, forms where the submit path doesn't reach a mutation.
2. **Half-wired seams.** Cross-reference API routes (`app/api/**`) against UI consumers; cross-reference `useMutation`/`useQuery` usage against invalidation and state flow.
3. **Explicit unfinished markers.** Grep the markers listed in scope.
4. **Shape mismatches.** For each feature area, read the zod schema / TS type, the API route, and the UI consumer; look for drift.

## Per-finding workflow

For each suspected defect:

1. Read the code to confirm it's a real bug and not intentional behaviour.
2. Run `gitnexus_impact({target: "<symbol>", direction: "upstream"})` on the symbol being edited. CLAUDE.md requires this.
3. Classify:
   - **Low-risk + clear fix** → fix in place.
   - **HIGH / CRITICAL impact** → stop, report, ask.
   - **Ambiguous intent** (could be a design decision) → stop, report, ask.
   - **Requires skip-list file** → stop, report, ask.
4. Group related fixes per feature area into a single commit with a conventional-commit message.
5. Run `gitnexus_detect_changes()` before each commit to verify scope.

## Commit cadence

One commit per fix-group (feature area). Not per file. Not one big commit. No amend, no force-push, no auto-tag/release — this is a fix sweep, not a feature ship.

## Stop conditions

Halt and surface to the user when any of these occur:

- `gitnexus_impact` returns HIGH or CRITICAL risk.
- Intent is ambiguous (the "bug" could plausibly be a design choice).
- The fix requires editing a skip-list file.
- A finding reveals a class of bug wide enough that a per-instance fix is the wrong approach (e.g. every mutation is missing invalidation) — report and decide strategy before continuing.

## Deliverable

At the end of the sweep, a summary message listing:

- Fixes shipped, with commit SHAs, grouped by feature area.
- Findings deferred, with the reason (hit stop condition, out of scope, etc.).
- Findings investigated that turned out to be non-issues (so we don't re-flag them next time).

## Non-goals (explicit)

- Not producing a standalone audit report document — the commits + final summary are the artefact.
- Not fixing things I notice that fall outside the scoped defect classes (polish, refactors, style).
- Not touching tests unless a fix requires it.

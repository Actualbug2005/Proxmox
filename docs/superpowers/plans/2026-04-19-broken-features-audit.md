# Broken / Limited Features — Audit + Fix Sweep: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Deliberate template deviation:** this is a static audit, not a feature build. Per the approved spec (`docs/superpowers/specs/2026-04-19-broken-features-audit-design.md`), test additions are **out of scope** unless a specific fix demands one. Tasks therefore do not use TDD — they use **detect → confirm → impact-check → fix → verify → commit**. Findings are discovered during execution, so phases define a **repeatable per-finding loop** rather than pre-named fixes.

**Goal:** Sweep the whole `nexus/src` tree for features that are broken or only partially wired, and fix them in place.

**Architecture:** Seven detection phases, one per feature area. Each phase runs four detection passes (dead handlers, half-wired seams, unfinished markers, shape mismatches), then applies a per-finding fix loop. One commit per fix-group (per feature area). Final phase produces a summary.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, TanStack Query 5, zod (implicit via schemas), GitNexus MCP for impact analysis.

---

## Phase 0 — Preflight

**Files:** none created; verifying tooling only.

- [ ] **Step 0.1: Refresh GitNexus index**

The post-commit hook flagged a stale index at b9421c2. Without a fresh index, `gitnexus_impact` returns wrong blast radius.

Run: `cd /Users/devlin/Documents/GitHub/Proxmox && npx gitnexus analyze --embeddings`
Expected: analyze completes, `.gitnexus/meta.json` updates with a new commit SHA.

- [ ] **Step 0.2: Verify baseline build is green**

Run: `cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit`
Expected: no errors. If there are pre-existing errors, record them — we do not want to attribute them to our fixes later.

Run: `cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npm run lint`
Expected: clean or pre-existing warnings only. Record baseline.

Run: `cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npm test`
Expected: clean. Record baseline.

- [ ] **Step 0.3: Confirm a clean working tree**

Run: `cd /Users/devlin/Documents/GitHub/Proxmox && git status`
Expected: `working tree clean` on `main`. If not, stop and report.

---

## The Per-Finding Fix Loop

**Run this loop inside each phase, once per finding.** The phases are just scoped grep/read passes that produce findings; the loop is how each finding becomes (or doesn't become) a commit.

- [ ] **Loop step A — Confirm it's a real defect.**
  Read the code. Ask: does the symptom match one of the scoped defect classes (dead handler, half-wired seam, unfinished marker, shape mismatch)? If it's polish or a design choice, **log-and-skip** (record in phase notes, do not fix).

- [ ] **Loop step B — Check the skip list.**
  If the fix requires editing auth/CSRF internals, noVNC/xterm, or anything under `docs/`/`deploy/`/`install.sh`, **stop and report to the user**. Do not fix unilaterally.

- [ ] **Loop step C — Impact analysis (REQUIRED by CLAUDE.md).**
  Identify the symbol being edited. Run:
  ```
  gitnexus_impact({ target: "<symbolName>", direction: "upstream" })
  ```
  - LOW/MEDIUM risk → continue to step D.
  - HIGH/CRITICAL → **stop and report to the user**. Do not fix unilaterally.

- [ ] **Loop step D — Apply the minimal fix.**
  Smallest change that resolves the defect. No surrounding refactor. No comment additions. No opportunistic cleanup.

- [ ] **Loop step E — Verify locally.**
  ```
  cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
  cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npm run lint
  ```
  Must not introduce new errors vs. the Phase 0 baseline. If a test exists that covers the fixed symbol, also run `npm test`.

- [ ] **Loop step F — Defer the commit to the end of the phase.**
  Do not commit per-finding. Accumulate fixes within the phase and commit once at the end (see each phase's "Commit" step). This gives us one commit per feature area, as agreed in the spec.

---

## Detection Pattern Reference

**Use these greps inside every phase.** Scope the `path` argument to that phase's directory.

**Pass 1 — Dead handlers.** Look for:
- `onClick={() => {}}` — literal empty handler
- `onSubmit={.*=>\s*\{?\s*\}?}` where body doesn't call a mutation
- `<button[^>]*>(?![^<]*onClick)` — button tag without onClick attribute nearby
- `disabled\s*=\s*{?true}?` without any code that sets `disabled` conditionally
- `// @ts-expect-error` and `// @ts-ignore`

**Pass 2 — Half-wired seams.**
- `useMutation\(` followed by a handler that doesn't call `queryClient.invalidateQueries` and doesn't return a value used elsewhere.
- For each file in `src/app/api/**/route.ts`, grep `src/` for a `fetch(` or `fetcher(` call hitting that path. No consumer → orphan route.
- For each `fetch('/api/...')` in `src/components`/`src/hooks`, verify the route file exists under `src/app/api/**/route.ts`.
- `const [x, setX] = useState` where `setX` is never called in the component.

**Pass 3 — Unfinished markers.**
```
TODO|FIXME|XXX|not implemented|NotImplemented|501|console\.warn\(.*(stub|TODO|FIXME)
```

**Pass 4 — Shape mismatches.**
- For the phase's feature area, open the zod schema (if any), the TS type, the API route, and the primary UI consumer. Read them side by side. Record any field that appears in one but not all three.

---

## Phase 1 — NAS (most recently shipped, highest suspicion)

**Files:**
- Search: `nexus/src/app/api/nas/**`, `nexus/src/app/(app)/**` filenames containing `nas`, `nexus/src/components/**` filenames containing `nas`, `nexus/src/hooks/**` filenames containing `nas`, `nexus/src/lib/**` filenames containing `nas`.

- [ ] **Step 1.1: Enumerate the NAS surface.**
  Run Glob for `**/nas/**` and `**/*nas*` under `nexus/src`. List the result in phase notes. This is the file set you will probe.

- [ ] **Step 1.2: Run detection pass 1 (dead handlers) on the NAS file set.**
  Use the Grep patterns from Detection Pattern Reference. For each hit, run the fix loop (steps A–F). Log every finding — even ones you log-and-skip.

- [ ] **Step 1.3: Run detection pass 2 (half-wired seams) on the NAS file set.**
  Cross-reference API routes under `app/api/nas/**` against UI consumers. For each orphan or mismatch, run the fix loop.

- [ ] **Step 1.4: Run detection pass 3 (unfinished markers) on the NAS file set.**
  For each marker, run the fix loop. A `TODO` with no code consequence is log-and-skip.

- [ ] **Step 1.5: Run detection pass 4 (shape mismatches) on the NAS file set.**
  Open schema + route + UI for each distinct NAS endpoint. Run the fix loop on any drift.

- [ ] **Step 1.6: Phase verify.**
  ```
  cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
  cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npm run lint
  cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npm test
  ```
  Must match or improve the Phase 0 baseline.

- [ ] **Step 1.7: Pre-commit scope check.**
  Run `gitnexus_detect_changes({ scope: "staged" })`. Confirm the affected files are all NAS-scoped. If the diff reaches outside NAS unexpectedly, stop and report.

- [ ] **Step 1.8: Commit phase fixes (skip if no fixes were made).**
  ```
  cd /Users/devlin/Documents/GitHub/Proxmox && git add <nas files touched> && git commit -m "$(cat <<'EOF'
  fix(nas): repair broken/limited features surfaced by static audit

  <one-line per finding: what was broken, what it does now>

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 2 — Notifications

**Files:** `nexus/src/app/api/notifications/**`, UI/components/hooks/lib containing `notification`.

- [ ] **Step 2.1: Enumerate the Notifications surface** (same approach as 1.1).
- [ ] **Step 2.2: Detection pass 1 — dead handlers.** Fix loop per finding.
- [ ] **Step 2.3: Detection pass 2 — half-wired seams.** Fix loop per finding.
- [ ] **Step 2.4: Detection pass 3 — unfinished markers.** Fix loop per finding.
- [ ] **Step 2.5: Detection pass 4 — shape mismatches.** Fix loop per finding.
- [ ] **Step 2.6: Phase verify** (tsc, lint, test — same commands as 1.6).
- [ ] **Step 2.7: Pre-commit scope check** (`gitnexus_detect_changes`).
- [ ] **Step 2.8: Commit phase fixes.**
  Message template: `fix(notifications): repair broken/limited features surfaced by static audit` + one-line-per-finding body + Co-Authored-By footer.

---

## Phase 3 — Scheduling, Updates, DRS, Guest Agent (automation cluster)

These four shipped in the last month and share code paths (schedulers, task runners, policy evaluation). Audit them as one phase.

**Files:** `nexus/src/app/api/proxmox/**` schedulers/updates, `nexus/src/hooks/**` containing `schedule|update|drs|guest`, `nexus/src/lib/**` containing `schedule|update|drs|guest`, `nexus/src/components/**` containing `schedule|update|drs|guest`.

- [ ] **Step 3.1: Enumerate surface.**
- [ ] **Step 3.2–3.5: Detection passes 1–4** (same structure as Phase 2).
- [ ] **Step 3.6: Phase verify.**
- [ ] **Step 3.7: Pre-commit scope check.**
- [ ] **Step 3.8: Commit phase fixes.**
  Message: `fix(automation): repair broken/limited features in scheduling/updates/drs/guest-agent audit`. If fixes cluster cleanly under a single subsystem (e.g. all were DRS), split the scope in the message.

---

## Phase 4 — Dashboards, DnD, Bento, Command Palette (UX cluster)

**Files:** `nexus/src/app/(app)/dashboard/**`, components containing `bento|dnd|palette|command`.

- [ ] **Step 4.1: Enumerate surface.**
- [ ] **Step 4.2–4.5: Detection passes 1–4.**
- [ ] **Step 4.6: Phase verify.**
- [ ] **Step 4.7: Pre-commit scope check.**
- [ ] **Step 4.8: Commit phase fixes.**
  Message: `fix(ux): repair broken/limited features surfaced by static audit`.

---

## Phase 5 — Resources Explorer, Audit Log, UnitInput (read/primitives cluster)

**Files:** `nexus/src/app/(app)/**` containing `resources|audit`, `nexus/src/components/**` containing `resource|audit|UnitInput`.

- [ ] **Step 5.1: Enumerate surface.**
- [ ] **Step 5.2–5.5: Detection passes 1–4.**
- [ ] **Step 5.6: Phase verify.**
- [ ] **Step 5.7: Pre-commit scope check.**
- [ ] **Step 5.8: Commit phase fixes.**
  Message: `fix(explorer): repair broken/limited features surfaced by static audit`.

---

## Phase 6 — Scripts, Exec, Tunnels, ISO upload, User prefs, System (long-tail)

Everything recent-ish that hasn't been covered. Keeps coverage complete per the whole-app sweep agreement.

**Files:** `nexus/src/app/api/{scripts,exec,tunnels,iso-upload,user-prefs,system}/**`, plus their UI/component/hook consumers.

- [ ] **Step 6.1: Enumerate surface.**
- [ ] **Step 6.2–6.5: Detection passes 1–4.**
- [ ] **Step 6.6: Phase verify.**
- [ ] **Step 6.7: Pre-commit scope check.**
- [ ] **Step 6.8: Commit phase fixes.**
  Message: `fix(misc): repair broken/limited features surfaced by static audit`. Split scope if fixes cluster.

---

## Phase 7 — Cross-cutting (lib, hooks, types)

By this point the phase greps may have surfaced defects in shared code (`src/lib/**`, `src/hooks/**` not tied to one feature, `src/types/**`). Cross-cutting fixes deferred during earlier phases land here.

**Files:** anything in `src/lib`, `src/hooks`, `src/types` that was flagged but not fixed during a feature phase because the blast radius spanned areas.

- [ ] **Step 7.1: Review deferred-cross-cutting log** from earlier phases. If empty, skip this phase.
- [ ] **Step 7.2: For each deferred item, run the fix loop** — including a **second** impact check (shared code needs extra care). If it's HIGH/CRITICAL now that the graph is fully populated, stop and report.
- [ ] **Step 7.3: Phase verify.**
- [ ] **Step 7.4: Pre-commit scope check** — confirm edits really are cross-cutting and not in a feature area we already shipped.
- [ ] **Step 7.5: Commit phase fixes.**
  Message: `fix(core): repair cross-cutting defects surfaced by audit`.

---

## Phase 8 — Summary

- [ ] **Step 8.1: Produce the final summary for the user.**
  No files, no commits. A single message containing:
  1. **Fixes shipped:** per phase, bulleted list of `<commit-sha> — <one-line summary>`.
  2. **Deferred to user:** findings that hit a stop condition (HIGH/CRITICAL impact, ambiguous intent, skip-list file). Each with file:line, the symptom, why it was deferred, and a recommended fix.
  3. **Non-issues investigated:** findings probed and determined to be intentional, so we don't re-flag them next sweep.
  4. **Baseline delta:** compare Phase 0 baseline (tsc/lint/test counts) against final — confirm parity or improvement.

- [ ] **Step 8.2: Do NOT auto-tag, release, or push.**
  Spec says this is a fix sweep, not a feature ship. Leave tagging/pushing to the user.

---

## Self-review

- **Spec coverage:** Every item in `Scope / In scope` of the spec maps to a Detection Pattern, which every phase runs. Skip list is enforced in Loop step B. Stop conditions are enforced in Loop steps B and C plus Phase 7 step 7.2. Deliverable matches Phase 8. ✓
- **Placeholder scan:** No "TBD", "TODO", "similar to Task N", "add appropriate error handling". Every step is an action. ✓
- **Type consistency:** No symbols are invented across tasks — the plan is a process, not a code spec. ✓
- **Template deviation:** Explicitly declared at the top. The TDD-shaped template doesn't fit a scoped-B static audit with "no new tests" — deviation is deliberate and spec-traceable. ✓

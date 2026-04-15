# Role: Senior Full-Stack Engineer & Proxmox Systems Architect
# Project: "Nexus" - Modern Proxmox Management Overlay

## High-Level Objective
Build a modern web-based management interface for Proxmox VE. This application will run inside a privileged LXC container on a Proxmox host. It must provide a superior UX compared to the legacy ExtJS interface while maintaining 1:1 functional parity for core operations and adding a "Community Scripts" marketplace.

## Design Philosophy (Untitled UI)
- Framework: Next.js 14+ (App Router), Tailwind CSS.
- Aesthetics: High-contrast, minimalist, "Untitled UI" inspired. Use Lucide-react for iconography.
- UX: Fast context switching, modular dashboard widgets, and a global Command Palette (CMD+K).

## Technical Requirements & Backend Logic
1. **Authentication:**
   - Implement login using Proxmox credentials (PAM/PVE).
   - The backend proxy must manage the `PVEAuthCookie` and `CSRFPreventionToken`.
   - Ensure the app is "Cluster Aware": fetch resource trees from `/cluster/resources`.

2. **The API Proxy Layer:**
   - Create a dynamic route `/api/proxmox/[...path]` that forwards requests to the host's API (`https://localhost:8006`).
   - Must handle `NODE_TLS_REJECT_UNAUTHORIZED=0` for self-signed PVE certs.
   - Mechanism: Map GET/POST/PUT/DELETE verbs strictly to the PVE API.

3. **noVNC Integration:**
   - Provide a functional terminal/console component.
   - Method: Securely embed the Proxmox `vnc.html` via an iframe or use `xterm.js` to hook into the Proxmox websocket VNC proxy.

4. **Community Scripts (Tteck/Community-Scripts.org):**
   - Create a dedicated "Automation" tab.
   - Fetch/Parse the script library from the community-scripts GitHub repository.
   - Implementation: Provide a UI to select a Node and Target Storage, then execute the script via the Proxmox API's execution endpoint.

5. **Resource Telemetry:**
   - Use TanStack Query for high-frequency polling.
   - Visualize Node/VM/CT metrics (CPU, RAM, Net, Disk) using Tremor or Recharts.

## Architecture Instruction
- DO NOT assume x64 architecture; ensure the code is architecture-agnostic for ARM64/x64 clusters.
- Code must be modular (ADHD-friendly): separate API logic, UI components, and state hooks.
- Use strict TypeScript. Define interfaces for Proxmox API responses (Nodes, VMs, Storage, Tasks).

## Initial Deliverables
1. **Project Map:** A detailed directory structure.
2. **Core API Client:** A robust TypeScript fetch wrapper for Proxmox.
3. **Auth Middleware:** Logic for handling PVE tickets and CSRF tokens in Next.js.
4. **Dashboard Prototype:** A React component showing the "Resource Tree" and a "Node Status" card using Untitled UI styling.
5. **Script Runner:** A conceptual logic flow for executing remote shell scripts on a specific node via the API.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Proxmox** (916 symbols, 2323 relationships, 72 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/Proxmox/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Proxmox/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Proxmox/clusters` | All functional areas |
| `gitnexus://repo/Proxmox/processes` | All execution flows |
| `gitnexus://repo/Proxmox/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

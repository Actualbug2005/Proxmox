# Project Overview

**Repo**: `/Users/devlin/Documents/GitHub/Proxmox`
**Application name**: Nexus — a modern web-based management overlay for Proxmox VE.
**Main app directory**: `nexus/` (Next.js app). Root holds `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/`, `install.sh`.

## Purpose

Nexus is a privileged LXC-hosted webapp providing a superior UX compared to PVE's legacy ExtJS interface. Goals:

1. 1:1 functional parity with core Proxmox operations (nodes, VMs, CTs, storage, tasks, console)
2. Cluster-aware: fetches from `/cluster/resources` and federates per-node listings
3. Extra features: global Command Palette (CMD+K), Community Scripts marketplace with categorised index + dynamic option forms + SSH execution, modular dashboard widgets

## Tech Stack

- **Framework**: Next.js 16+ (App Router) — *not* legacy Next. See `nexus/AGENTS.md`: "This is NOT the Next.js you know". Check `node_modules/next/dist/docs/` for current API.
- **Runtime**: React 19, Node (ESM via `"type": "module"`, start script uses `node --experimental-strip-types server.ts`)
- **State / data**: TanStack Query v5 for polling and mutations
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`). Hybrid "Liquid Glass + Solid Industrial" design system.
- **Icons**: `lucide-react`
- **Terminal / console**: `@xterm/xterm` + addons, `ws` for websocket proxy
- **Charts**: `recharts`
- **Command palette**: `cmdk`
- **Auth / crypto**: `jose` (JWT), httpOnly session cookie + non-httpOnly `nexus_csrf` cookie
- **Cache**: `ioredis`
- **TypeScript**: strict, v5

## Architecture Highlights

- **Route group `(app)/`** — shared authenticated shell. The master layout at `src/app/(app)/layout.tsx` gates the session, renders the aurora mesh background, SVG noise overlay, floating Liquid Glass sidebar capsule, and CommandPalette. `/dashboard`, `/scripts`, `/console` all live under this group and inherit the shell. URL paths are unchanged by the route group.
- **Aurora mesh background** — 3 oversized colour nodes (violet, midnight blue, teal) blurred to 150px with `mix-blend-mode: screen`, plus fractalNoise overlay at `mix-blend-mode: overlay`.
- **Floating sidebar capsule** — `fixed top-4 left-4 bottom-4 rounded-[24px]` with `liquid-glass` class (backdrop-filter blur against aurora). Active pills use `mix-blend-plus-lighter` for etched look.
- `src/app/api/proxmox/[...path]` — dynamic proxy forwarding every call to `https://localhost:8006`. Handles `NODE_TLS_REJECT_UNAUTHORIZED=0` for self-signed PVE certs. Injects `PVEAuthCookie` + `CSRFPreventionToken` from the server-side session.
- `src/lib/proxmox-client.ts` — typed fetch wrapper. `api.<resource>.<verb>()` is the canonical call site. `MUTATING` set (POST/PUT/DELETE) triggers CSRF.
- `src/lib/community-scripts.ts` — upstream fetcher with `UpstreamFetchError` discriminated union, `fetchScriptIndex`, `fetchScriptManifest`, `groupByCategory`. Types: `ScriptManifest`, `ScriptCategory`, `ScriptOption`.
- `src/app/api/scripts/run/route.ts` — CSRF-validated, ACL-enforced SSH execution pipeline. URL origin whitelist + pathname regex + bash stdin pipe.
- `src/types/proxmox.ts` — canonical interface definitions for all PVE API responses and request payloads.
- `src/components/ui/` — primitives: `badge`, `gauge`, `progress-bar`, `status-dot`, `stat-card`, `toast`.

## Code Intelligence

The repo is indexed by **GitNexus** (`.gitnexus/` folder). See `CLAUDE.md` for the required workflow: `gitnexus_impact` before edits, `gitnexus_detect_changes` before commits. A PostToolUse hook reindexes after `git commit`/`merge`.

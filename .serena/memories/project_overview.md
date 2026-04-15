# Project Overview

**Repo**: `/Users/devlin/Documents/GitHub/Proxmox`
**Application name**: Nexus — a modern web-based management overlay for Proxmox VE.
**Main app directory**: `nexus/` (Next.js app). Root holds `CLAUDE.md`, `AGENTS.md`, `docs/`, `install.sh`.

## Purpose

Nexus is a privileged LXC-hosted webapp that provides a superior UX compared to PVE's legacy ExtJS interface. Goals:

1. 1:1 functional parity with core Proxmox operations (nodes, VMs, CTs, storage, tasks, console)
2. Cluster-aware: fetches from `/cluster/resources` and federates per-node listings
3. Extra features: global Command Palette (CMD+K), Community Scripts marketplace (Tteck / community-scripts.org), modular dashboard widgets

## Tech Stack

- **Framework**: Next.js 16.2.3 (App Router) — *not* legacy Next. See `nexus/AGENTS.md`: "This is NOT the Next.js you know". Check `node_modules/next/dist/docs/` for current API.
- **Runtime**: React 19.2.4, Node (ESM via `"type": "module"`, start script uses `node --experimental-strip-types server.ts`)
- **State / data**: TanStack Query v5 for polling and mutations
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`), "Untitled UI" inspired dark aesthetic
- **Icons**: `lucide-react`
- **Terminal / console**: `@xterm/xterm` + addons, `ws` for websocket proxy
- **Charts**: `recharts`
- **Command palette**: `cmdk`
- **Auth / crypto**: `jose` (JWT), httpOnly session cookie + non-httpOnly `nexus_csrf` cookie
- **Cache**: `ioredis`
- **TypeScript**: strict, v5

## Architecture Highlights

- `src/app/api/proxmox/[...path]` — dynamic proxy forwarding every call to `https://localhost:8006`. Handles `NODE_TLS_REJECT_UNAUTHORIZED=0` for self-signed PVE certs. Injects `PVEAuthCookie` + `CSRFPreventionToken` from the server-side session; client attaches `X-Nexus-CSRF` for mutating verbs.
- `src/lib/proxmox-client.ts` — typed fetch wrapper. `api.<resource>.<verb>()` is the canonical call site. `MUTATING` set (POST/PUT/DELETE) triggers CSRF.
- `src/types/proxmox.ts` — canonical interface definitions for all PVE API responses and request payloads.
- `src/app/dashboard/*` — feature pages (nodes, vms, cts, storage, cluster, system, access, firewall, backups, ha, scripts, console).
- `src/components/ui/` — primitives: `badge`, `progress-bar`, `stat-card`, `toast`.
- `src/components/dashboard/confirm-dialog.tsx` — shared confirm modal with `danger` variant.
- `src/components/<feature>/` — feature-scoped components (storage, nas, firewall, access, ha, scripts, console, backups, auth).

## Code Intelligence

The repo is indexed by **GitNexus** (`.gitnexus/` folder). See `CLAUDE.md` for the required workflow: `gitnexus_impact` before edits, `gitnexus_detect_changes` before commits. A PostToolUse hook reindexes after `git commit`/`merge`.

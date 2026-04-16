# Codebase Structure

```
Proxmox/
├── CLAUDE.md              # Project/agent instructions (Nexus spec + GitNexus workflow)
├── AGENTS.md              # Top-level agent note
├── README.md              # Install, config, architecture, design system docs
├── docs/                  # Project docs
├── install.sh             # Installer for the LXC host
├── .gitnexus/             # GitNexus code-intelligence index (don't hand-edit)
└── nexus/                 # The Next.js application
    ├── AGENTS.md          # "This is NOT the Next.js you know" — read node_modules/next/dist/docs/
    ├── CLAUDE.md          # Re-exports AGENTS.md
    ├── package.json       # Scripts: dev/build/start/lint
    ├── tsconfig.json
    ├── server.ts          # Custom Node server entrypoint
    ├── next.config.ts
    └── src/
        ├── proxy.ts
        ├── types/
        │   ├── proxmox.ts   # Canonical PVE types (responses + payloads)
        │   └── nas.ts
        ├── lib/
        │   ├── proxmox-client.ts   # Typed fetch wrapper; PveBool codec; CSRF
        │   ├── community-scripts.ts # Upstream fetcher + ScriptManifest/Category/Option types
        │   ├── auth.ts
        │   ├── csrf.ts
        │   ├── session-store.ts    # Memory / Redis backends
        │   ├── permissions.ts
        │   ├── remote-shell.ts
        │   └── nas/providers/
        ├── hooks/
        │   └── use-cluster.ts      # useClusterResources, useNodes, POLL_INTERVALS
        ├── app/
        │   ├── layout.tsx          # Root HTML/body wrapper (Geist fonts)
        │   ├── page.tsx            # Redirect gate → /dashboard or /login
        │   ├── globals.css         # Design tokens + aurora mesh + Liquid Glass + noise overlay
        │   ├── login/
        │   ├── (app)/              # Route group — shared auth shell
        │   │   ├── layout.tsx      # Master shell: session gate, aurora mesh,
        │   │   │                   #   noise overlay, floating Sidebar capsule, CommandPalette
        │   │   ├── dashboard/      # Feature pages (nodes, vms, cts, storage, cluster, system, etc.)
        │   │   ├── console/        # xterm.js embed (locked viewport)
        │   │   └── scripts/        # Community Scripts marketplace
        │   └── api/
        │       ├── proxmox/[...path]/route.ts   # Dynamic proxy → PVE
        │       ├── scripts/route.ts             # GET index (?grouped=1 for categorised envelope)
        │       ├── scripts/[slug]/route.ts      # GET manifest detail per script
        │       └── scripts/run/route.ts         # POST SSH execution pipeline
        └── components/
            ├── providers.tsx
            ├── ui/                 # Primitives: badge, gauge, progress-bar, status-dot, stat-card, toast
            ├── dashboard/          # sidebar, resource-tree, node-card, command-palette, tab-bar, etc.
            ├── storage/            # Storage pools, NAS, physical disks, map-storage-dialog
            ├── nas/                # NAS shares UI
            ├── console/            # xterm integration
            ├── backups/
            ├── firewall/
            ├── access/             # Users, groups, roles, realms, ACL tabs
            └── ha/                 # HA groups / resources
```

## Design system

**Hybrid "Liquid Glass + Solid Industrial"**:
- **Chrome** (sidebar): Apple Liquid Glass — `backdrop-filter: blur(40px) saturate(200%)` over an aurora mesh (3 colour nodes blurred to 150px + SVG fractalNoise overlay). Floating capsule: `fixed top-4 left-4 bottom-4 rounded-[24px]`.
- **Workspace** (cards, tables): Solid Industrial — `bg-zinc-900`, `border-zinc-800/60`, `rounded-lg`. No backdrop-blur in the content plane.
- **Accessibility**: `@media (prefers-reduced-transparency: reduce)` collapses glass to solid zinc-900 and hides aurora. Focus rings on all interactive elements.
- **Typography**: Geist Sans/Mono. 11px section labels, 12px meta, 14px body, tabular-nums on numeric columns.

## Key files

- `src/app/api/proxmox/[...path]/route.ts` — proxy injecting PVEAuthCookie/CSRFPreventionToken
- `src/lib/proxmox-client.ts` — ALL browser-side PVE calls go through `api.<resource>.<verb>()`. `request<T>` auto-adds `X-Nexus-CSRF` on POST/PUT/DELETE.
- `src/lib/community-scripts.ts` — upstream fetcher with `UpstreamFetchError` discriminated union (timeout/network/http/parse/empty), `fetchScriptIndex`, `fetchScriptManifest`, `groupByCategory`.
- `src/types/proxmox.ts` — exhaustive type catalog. Any new PVE payload belongs here.
- `src/hooks/use-cluster.ts` — `POLL_INTERVALS` lives here; don't scatter timings.
- `src/app/(app)/layout.tsx` — master shell (aurora + noise + sidebar + CommandPalette).

## Common patterns

- **Dialogs**: overlay + stopPropagation card + explicit `onClose` / `on<Action>` props.
- **Lists / row actions**: rows in Next `<Link>`; buttons use `e.stopPropagation()`.
- **Mutations**: `useMutation` → `qc.invalidateQueries` + toast; `onError` → toast.
- **CSRF**: `readCsrfCookie()` + `X-Nexus-CSRF` header on every mutating fetch (terminal, scripts run, proxmox-client).

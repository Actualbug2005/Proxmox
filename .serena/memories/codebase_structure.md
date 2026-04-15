# Codebase Structure

```
Proxmox/
├── CLAUDE.md              # Project/agent instructions (Nexus spec + GitNexus workflow)
├── AGENTS.md              # Top-level agent note
├── docs/                  # Project docs
├── install.sh             # Installer for the LXC host
├── .gitnexus/             # GitNexus code-intelligence index (don't hand-edit)
└── nexus/                 # The Next.js application
    ├── AGENTS.md          # "This is NOT the Next.js you know" — read node_modules/next/dist/docs/
    ├── CLAUDE.md          # Re-exports AGENTS.md
    ├── package.json       # Scripts: dev/build/start/lint. No test runner.
    ├── tsconfig.json
    ├── server.ts          # Custom Node server entrypoint
    ├── next.config.ts
    └── src/
        ├── proxy.ts
        ├── types/
        │   ├── proxmox.ts   # Canonical PVE types (responses + payloads)
        │   └── nas.ts
        ├── lib/
        │   ├── proxmox-client.ts   # Single typed fetch wrapper; CSRF + credentials
        │   └── utils.ts            # cn(), formatBytes, memPercent, …
        ├── hooks/
        │   └── use-cluster.ts      # useClusterResources, useNodes, POLL_INTERVALS
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx
        │   ├── globals.css
        │   ├── login/
        │   ├── console/
        │   ├── scripts/
        │   ├── api/                # Server routes (Proxmox proxy, NAS, tunnels, iso-upload)
        │   │   └── proxmox/[...path]/route.ts   # The critical proxy
        │   └── dashboard/          # Feature pages (nodes, vms, cts, storage, cluster, system, access, firewall, backups, ha, scripts, console)
        └── components/
            ├── providers.tsx
            ├── ui/                 # Primitives: badge, progress-bar, stat-card, toast
            ├── auth/
            ├── dashboard/
            │   └── confirm-dialog.tsx   # Shared destructive prompt (use `danger`)
            ├── storage/            # Storage pools, NAS, physical disks, map-storage-dialog
            ├── nas/                # NAS shares UI
            ├── console/            # xterm integration
            ├── backups/
            ├── firewall/
            ├── access/             # Users, groups, roles, realms, ACL tabs
            ├── ha/                 # HA groups / resources
            └── scripts/            # Community-scripts marketplace
```

## Key files to know

- `src/app/api/proxmox/[...path]/route.ts` — the proxy that injects `PVEAuthCookie`/`CSRFPreventionToken` and tolerates self-signed certs.
- `src/lib/proxmox-client.ts` — ALL browser-side PVE calls go through `api.<resource>.<verb>()` here. `request<T>` auto-adds `X-Nexus-CSRF` on POST/PUT/DELETE.
- `src/types/proxmox.ts` — exhaustive type catalog. Any new PVE payload belongs here.
- `src/hooks/use-cluster.ts` — `POLL_INTERVALS` lives here; do not scatter poll timings across components.
- `src/components/dashboard/confirm-dialog.tsx` — shared destructive-action modal.

## Common patterns

- **Dialogs**: overlay + stopPropagation card + explicit `onClose` / `on<Action>` props. Collapsible sections use native `<details>` + `ChevronDown` rotate.
- **Lists / row actions**: rows wrapped in Next `<Link>`; buttons inside use `e.preventDefault(); e.stopPropagation()` to avoid triggering navigation.
- **Mutations**: `useMutation` with `onSuccess` → `qc.invalidateQueries({ queryKey: ['<root>'] })` + toast; `onError` → toast.

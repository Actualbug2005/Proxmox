# Tier 4 — System: Design Spec
**Date:** 2026-04-14  
**Project:** Nexus — Proxmox Management UI  
**Status:** Approved

---

## Overview

Tier 4 adds a System management area to Nexus covering node power controls, package updates, network configuration, certificate/tunnel management, a journal log viewer, and per-VM/CT RRD metrics charts.

---

## 1. Routing & Navigation

### New Routes
```
/dashboard/system/power
/dashboard/system/packages
/dashboard/system/network
/dashboard/system/certificates
/dashboard/system/logs
```

### New Files
```
src/app/dashboard/system/layout.tsx           — shared node-selector header
src/app/dashboard/system/power/page.tsx
src/app/dashboard/system/packages/page.tsx
src/app/dashboard/system/network/page.tsx
src/app/dashboard/system/certificates/page.tsx
src/app/dashboard/system/logs/page.tsx
```

### Sidebar Change
The flat `nav` array in `src/components/dashboard/sidebar.tsx` gains a collapsible "System" group with a `Settings` icon. When any `/dashboard/system/*` route is active, the group expands to show five sub-links (Power, Packages, Network, Certificates, Logs). Active detection uses `pathname.startsWith('/dashboard/system')`.

### System Layout
`system/layout.tsx` renders a sticky node-selector dropdown at the top, populated from `useNodes()`. The selected node is stored in an exported React context (`SystemNodeContext` + `useSystemNode` hook) so all child pages can import and read it without prop-drilling. Defaults to the first online node.

---

## 2. Power (Node Reboot / Shutdown)

**Route:** `/dashboard/system/power`

### UI
- Node is selected via the shared system layout node picker.
- Two action cards: **Reboot** and **Shutdown**.
- Each card shows current node uptime (from `api.nodes.status()`).
- Clicking either action opens the existing `ConfirmDialog` component with node name in the warning text.
- After confirmation a toast banner shows "Reboot/Shutdown initiated for {node}".
- The node status badge in the resource tree flips naturally via the existing polling.

### API
| Action | Endpoint |
|--------|----------|
| Reboot | `POST nodes/{node}/status` `{ command: 'reboot' }` |
| Shutdown | `POST nodes/{node}/status` `{ command: 'shutdown' }` |

No new proxy logic required — both route through the existing `/api/proxmox/[...path]` handler.

**New client method:**
```ts
api.nodes.power(node, command: 'reboot' | 'shutdown')
  → POST nodes/{node}/status
```

---

## 3. Package Updates

**Route:** `/dashboard/system/packages`

### UI
Two tabs: **PVE Packages** (default) and **System Packages**.

**PVE Packages tab:**
- On mount, fires `api.apt.update(node)` to refresh the apt cache (returns UPID, tracked inline).
- Then calls `api.apt.versions(node)` to list installed PVE packages with current vs available versions.
- "Upgrade All PVE Packages" button fires `api.apt.install(node, [])` (empty array = full upgrade), returns UPID shown with live status badge.

**System Packages tab:**
- Calls `api.apt.upgradable(node)` for the full upgradable package list.
- Searchable table: Package, Current Version, Available Version, Section columns.
- Checkbox-selectable rows.
- "Upgrade Selected" and "Upgrade All" buttons — both fire `api.apt.install(node, packages[])`, return UPID tracked inline.

### New API Client Methods
```ts
api.apt.versions(node)           → GET  nodes/{node}/apt/versions    (installed PVE package list)
api.apt.update(node)             → POST nodes/{node}/apt/update       (refresh apt cache, returns UPID)
api.apt.upgradable(node)         → GET  nodes/{node}/apt/update       (list upgradable packages — same path, GET verb)
api.apt.install(node, packages)  → POST nodes/{node}/apt/install      (packages=[] means full upgrade)
```

---

## 4. Network Config

**Route:** `/dashboard/system/network`

### UI
Two-panel layout:
- **Left panel:** Interface list — iface name, type badge (bridge / bond / vlan / eth), active status dot. "New Interface" button at top.
- **Right panel:** Detail / edit form for selected interface.

**Viewing:** Selecting an interface calls `api.network.get(node, iface)`. Shows: address, netmask, gateway, bridge_ports, bond slaves, VLAN tag, autostart, comments.

**Creating:** "New Interface" opens a slide-over drawer with a type selector. Form fields are conditional on type:
- `bridge` → bridge_ports, bridge_stp, bridge_fd
- `bond` → bond_mode, slaves
- `vlan` → vlan-raw-device, vlan tag
- `eth` → address, netmask, gateway

Fires `POST nodes/{node}/network`.

**Editing:** Detail panel fields become editable inline. Fires `PUT nodes/{node}/network/{iface}`.

**Deleting:** Trash icon in detail panel → ConfirmDialog → `DELETE nodes/{node}/network/{iface}`.

**Pending changes banner:** A persistent yellow banner appears when `GET nodes/{node}/network` returns a non-null `changes` field. Contains "Apply Configuration" (`PUT nodes/{node}/network/apply`) and "Revert" (`DELETE nodes/{node}/network`) buttons.

### New API Client Methods
```ts
api.network.get(node, iface)           → GET    nodes/{node}/network/{iface}
api.network.create(node, params)       → POST   nodes/{node}/network
api.network.update(node, iface, params)→ PUT    nodes/{node}/network/{iface}
api.network.delete(node, iface)        → DELETE nodes/{node}/network/{iface}
api.network.apply(node)                → PUT    nodes/{node}/network/apply
api.network.revert(node)               → DELETE nodes/{node}/network
```

---

## 5. Certificates & Tunnels

**Route:** `/dashboard/system/certificates`

Three tabs: **Current Cert**, **ACME / Let's Encrypt**, **Tunnel Providers**.

### Current Cert Tab
- Displays active certificate: subject, SANs, issuer, expiry with color-coded countdown (green >30 days, yellow <30, red <7).
- "Upload Custom Certificate" form: two textareas (PEM certificate + private key). Fires `api.certificates.uploadCustom(node, cert, key)`.
- "Delete Custom Certificate" button reverts to self-signed cert. Fires `api.certificates.deleteCustom(node)`.

### ACME / Let's Encrypt Tab
Two sub-sections:
- **Account:** Shows ACME account email and registration status. "Register Account" form fires `api.acme.registerAccount(params)` then associates account to node via `PUT nodes/{node}/config`.
- **Domains:** Lists configured domains for this node. "Add Domain" fires `PUT nodes/{node}/config` with updated `acme` field. "Order Certificate" fires `api.certificates.orderAcme(node)` (returns UPID, tracked in Tasks).

### Tunnel Providers Tab
Card grid of supported providers. Initial set: **ngrok**, **Cloudflare Tunnel** (`cloudflared`). Extensible — new providers added by adding a config entry.

Each card shows:
- **Install status** — detected via `POST nodes/{node}/execute` checking if binary exists (`which ngrok`, `which cloudflared`).
- **Install button** — runs the provider's official install script via exec endpoint.
- **Config form** — auth token, tunnel name, etc. Written to config file via exec.
- **Enable / Disable** — systemd service toggle via `POST nodes/{node}/execute` (`systemctl enable/disable/start/stop {service}`).
- **Status indicator** — polling `systemctl is-active {service}` every 10s.

### New API Client Methods
```ts
api.certificates.list(node)                    → GET    nodes/{node}/certificates
api.certificates.uploadCustom(node, cert, key) → POST   nodes/{node}/certificates/custom
api.certificates.deleteCustom(node)            → DELETE nodes/{node}/certificates/custom
api.certificates.orderAcme(node)               → POST   nodes/{node}/certificates/acme/certificate
api.acme.accounts()                            → GET    cluster/acme/account
api.acme.registerAccount(params)               → POST   cluster/acme/account
```

---

## 6. Logs / Journal Viewer

**Route:** `/dashboard/system/logs`

### UI
Mode toggle (Table / Live Tail) in the top-right of the page.

**Table mode (default):**
- Calls `GET nodes/{node}/journal?lastentries=500`.
- Virtualized table (windowed rendering): Timestamp, Unit/Service, Priority (color-coded badge: error=red, warning=yellow, info/debug=gray), Message.
- Filter bar: free-text search (client-side on message + unit), priority dropdown, unit/service dropdown (populated from unique units in result set).
- "Load More" appends another 500 entries.

**Live Tail mode:**
- TanStack Query polling `GET nodes/{node}/journal?lastentries=50` every 2 seconds.
- Fixed-height terminal-style `<pre>` box: dark bg, monospace font, auto-scroll to bottom.
- "Pause" toggle stops polling without unmounting.
- Optional unit filter input passes `since` timestamp on subsequent polls to narrow the stream.

### New API Client Method
```ts
api.nodes.journal(node, params: { lastentries?: number; since?: string; unit?: string })
  → GET nodes/{node}/journal
```

---

## 7. Per-VM/CT RRD Metrics Tab

**Modified pages:**
- `src/app/dashboard/vms/[node]/[vmid]/page.tsx`
- `src/app/dashboard/cts/[node]/[vmid]/page.tsx`

### UI Change
A **"Metrics"** tab is added to both detail pages alongside existing tabs. Tab switching is local `useState` — no routing change.

The Metrics tab renders a new `<VMMetricsChart>` component.

### New Component: `src/components/dashboard/vm-metrics-chart.tsx`
Props: `node: string`, `vmid: number`, `type: 'qemu' | 'lxc'`

Charts (same style as `NodeMetricsChart`, using Recharts `AreaChart`):
- CPU usage
- Memory
- Network I/O (in + out)
- Disk I/O (read + write) — additive, not on node charts

Timeframe selector: 1h / 24h / 7d.

Internally calls `api.vms.rrd()` or `api.containers.rrd()` based on `type` prop. Both methods already exist in the client — no new API methods needed.

---

## New Types Required

```ts
// proxmox.ts additions
export interface AptPackage {
  package: string;
  version: string;
  new_version?: string;
  section?: string;
  description?: string;
  priority?: string;
}

export interface NetworkInterface {
  iface: string;
  type: string;
  active?: number;
  autostart?: number;
  address?: string;
  netmask?: string;
  gateway?: string;
  bridge_ports?: string;
  bond_mode?: string;
  comments?: string;
  cidr?: string;
  pending?: boolean;
}

export interface CertificateInfo {
  filename: string;
  subject?: string;
  san?: string[];
  issuer?: string;
  notbefore?: number;
  notafter?: number;
  fingerprint?: string;
  pem?: string;
}

export interface JournalEntry {
  t: string;   // timestamp
  m: string;   // message
  p?: string;  // priority
  u?: string;  // unit
}

export type NodePowerCommand = 'reboot' | 'shutdown';
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `src/app/dashboard/system/layout.tsx` | Shared node selector context |
| `src/app/dashboard/system/power/page.tsx` | Reboot / Shutdown |
| `src/app/dashboard/system/packages/page.tsx` | PVE + system apt packages |
| `src/app/dashboard/system/network/page.tsx` | Full network CRUD |
| `src/app/dashboard/system/certificates/page.tsx` | Certs + ACME + Tunnels |
| `src/app/dashboard/system/logs/page.tsx` | Journal table + live tail |
| `src/components/dashboard/vm-metrics-chart.tsx` | Per-VM/CT RRD charts |

## Summary of Modified Files

| File | Change |
|------|--------|
| `src/components/dashboard/sidebar.tsx` | Add collapsible System nav group |
| `src/lib/proxmox-client.ts` | Add apt, network, certificates, acme, journal API methods |
| `src/types/proxmox.ts` | Add AptPackage, NetworkInterface, CertificateInfo, JournalEntry, NodePowerCommand types |
| `src/app/dashboard/vms/[node]/[vmid]/page.tsx` | Add Metrics tab |
| `src/app/dashboard/cts/[node]/[vmid]/page.tsx` | Add Metrics tab |

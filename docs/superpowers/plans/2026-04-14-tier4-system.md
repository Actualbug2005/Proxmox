# Tier 4 — System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a System section to Nexus covering node power controls, package updates, network CRUD, certificates/ACME/tunnel providers, a journal log viewer, and per-VM/CT RRD metrics tabs.

**Architecture:** A collapsible System group in the sidebar routes to `/dashboard/system/{section}`. A shared layout provides a `SystemNodeContext` node-picker. Each section is an independent page. Per-VM/CT metrics are a new tab on existing detail pages backed by a new `VMMetricsChart` component.

**Tech Stack:** Next.js 14+ App Router, React, TanStack Query, Recharts, Tailwind CSS, TypeScript, Lucide-react, Proxmox VE REST API.

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `nexus/src/app/dashboard/system/layout.tsx` | Node-picker context provider, shared header |
| `nexus/src/app/dashboard/system/power/page.tsx` | Reboot / shutdown cards |
| `nexus/src/app/dashboard/system/packages/page.tsx` | PVE + system apt package tables |
| `nexus/src/app/dashboard/system/network/page.tsx` | Interface list + detail/edit panel |
| `nexus/src/app/dashboard/system/certificates/page.tsx` | Custom cert + ACME + tunnel providers |
| `nexus/src/app/dashboard/system/logs/page.tsx` | Journal table + live tail |
| `nexus/src/components/dashboard/vm-metrics-chart.tsx` | Per-VM/CT RRD area charts |

### Modified files
| Path | Change |
|------|--------|
| `nexus/src/types/proxmox.ts` | Add `AptPackage`, `NetworkIface`, `CertificateInfo`, `JournalEntry`, `NodePowerCommand` types |
| `nexus/src/lib/proxmox-client.ts` | Add `api.nodes.power`, `api.nodes.journal`, `api.apt.*`, `api.network.*`, `api.certificates.*`, `api.acme.*` |
| `nexus/src/components/dashboard/sidebar.tsx` | Add collapsible System nav group |
| `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx` | Add Metrics tab, wire `VMMetricsChart` |
| `nexus/src/app/dashboard/cts/[node]/[vmid]/page.tsx` | Add Metrics tab, wire `VMMetricsChart` |

---

## Task 1: Types + API Client Extensions

**Files:**
- Modify: `nexus/src/types/proxmox.ts`
- Modify: `nexus/src/lib/proxmox-client.ts`

- [ ] **Step 1: Add new types to `proxmox.ts`**

Open `nexus/src/types/proxmox.ts` and append after the last export:

```ts
// ─── Tier 4 — System ─────────────────────────────────────────────────────────

export type NodePowerCommand = 'reboot' | 'shutdown';

export interface AptPackage {
  package: string;
  version: string;
  new_version?: string;
  section?: string;
  description?: string;
  priority?: string;
}

export interface NetworkIface {
  iface: string;
  type: string;
  active?: number;
  autostart?: number;
  address?: string;
  netmask?: string;
  gateway?: string;
  bridge_ports?: string;
  bond_mode?: string;
  bond_slaves?: string;
  comments?: string;
  cidr?: string;
  'vlan-raw-device'?: string;
  'vlan-id'?: number;
  pending?: Record<string, string>;
}

export interface NetworkIfaceParams {
  type: 'bridge' | 'bond' | 'vlan' | 'eth';
  iface?: string;
  address?: string;
  netmask?: string;
  gateway?: string;
  autostart?: number;
  comments?: string;
  bridge_ports?: string;
  bridge_stp?: string;
  bridge_fd?: number;
  bond_mode?: string;
  slaves?: string;
  'vlan-raw-device'?: string;
  'vlan-id'?: number;
  [key: string]: unknown;
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

export interface AcmeAccount {
  name: string;
  contact?: string[];
  status?: string;
  location?: string;
}

export interface JournalEntry {
  t: string;
  m: string;
  p?: string;
  u?: string;
}

export interface JournalParams {
  lastentries?: number;
  since?: string;
  until?: string;
  [key: string]: unknown;
}
```

- [ ] **Step 2: Add API client methods to `proxmox-client.ts`**

Open `nexus/src/lib/proxmox-client.ts`. Add the new imports at the top of the import block:

```ts
import type {
  // ... existing imports ...
  ClusterResource,
  PVENode,
  NodeStatus,
  PVEVM,
  PVECT,
  PVEStorage,
  PVETask,
  VNCProxyResponse,
  NodeRRDData,
  VMConfig,
  VMConfigFull,
  CTConfig,
  StorageContent,
  NodeNetwork,
  CreateVMParams,
  CreateCTParams,
  CloneVMParams,
  CloneCTParams,
  MigrateVMParams,
  MigrateCTParams,
  UpdateVMConfigParams,
  UpdateCTConfigParams,
  NodePowerCommand,
  AptPackage,
  NetworkIface,
  NetworkIfaceParams,
  CertificateInfo,
  AcmeAccount,
  JournalEntry,
  JournalParams,
} from '@/types/proxmox';
```

Then extend the `api` object. Add `power` and `journal` to the `nodes` section:

```ts
nodes: {
  list: () => proxmox.get<PVENode[]>('nodes'),
  status: (node: string) => proxmox.get<NodeStatus>(`nodes/${node}/status`),
  rrd: (node: string, timeframe: 'hour' | 'day' | 'week' = 'hour') =>
    proxmox.get<NodeRRDData[]>(`nodes/${node}/rrddata?timeframe=${timeframe}&cf=AVERAGE`),
  tasks: (node: string) => proxmox.get<PVETask[]>(`nodes/${node}/tasks`),
  power: (node: string, command: NodePowerCommand) =>
    proxmox.post<string>(`nodes/${node}/status`, { command }),
  journal: (node: string, params: JournalParams = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return proxmox.get<JournalEntry[]>(`nodes/${node}/journal${qs ? `?${qs}` : ''}`);
  },
},
```

Add new top-level sections to the `api` object (after `exec`):

```ts
apt: {
  versions: (node: string) =>
    proxmox.get<AptPackage[]>(`nodes/${node}/apt/versions`),
  update: (node: string) =>
    proxmox.post<string>(`nodes/${node}/apt/update`),
  upgradable: (node: string) =>
    proxmox.get<AptPackage[]>(`nodes/${node}/apt/update`),
  install: (node: string, packages: string[]) =>
    proxmox.post<string>(`nodes/${node}/apt/install`, { packages: packages.join(' ') }),
},

// Note: named networkIfaces (not network) to avoid shadowing the existing api.network.list method
networkIfaces: {
  list: (node: string) =>
    proxmox.get<{ ifaces: NetworkIface[]; changes?: string }>(`nodes/${node}/network`),
  get: (node: string, iface: string) =>
    proxmox.get<NetworkIface>(`nodes/${node}/network/${iface}`),
  create: (node: string, params: NetworkIfaceParams) =>
    proxmox.post<string>(`nodes/${node}/network`, params as Record<string, unknown>),
  update: (node: string, iface: string, params: Partial<NetworkIfaceParams>) =>
    proxmox.put<string>(`nodes/${node}/network/${iface}`, params as Record<string, unknown>),
  delete: (node: string, iface: string) =>
    proxmox.delete<string>(`nodes/${node}/network/${iface}`),
  apply: (node: string) =>
    proxmox.put<string>(`nodes/${node}/network/apply`),
  revert: (node: string) =>
    proxmox.delete<string>(`nodes/${node}/network`),
},

certificates: {
  list: (node: string) =>
    proxmox.get<CertificateInfo[]>(`nodes/${node}/certificates`),
  uploadCustom: (node: string, certificates: string, key: string) =>
    proxmox.post<CertificateInfo[]>(`nodes/${node}/certificates/custom`, { certificates, key }),
  deleteCustom: (node: string) =>
    proxmox.delete<string>(`nodes/${node}/certificates/custom`),
  orderAcme: (node: string) =>
    proxmox.post<string>(`nodes/${node}/certificates/acme/certificate`),
  renewAcme: (node: string) =>
    proxmox.put<string>(`nodes/${node}/certificates/acme/certificate`),
},

acme: {
  accounts: () =>
    proxmox.get<AcmeAccount[]>('cluster/acme/account'),
  registerAccount: (name: string, contact: string, directory?: string) =>
    proxmox.post<string>('cluster/acme/account', {
      name,
      contact: `mailto:${contact}`,
      directory: directory ?? 'https://acme-v02.api.letsencrypt.org/directory',
    }),
},
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd nexus && git add src/types/proxmox.ts src/lib/proxmox-client.ts
git commit -m "feat(system): add Tier 4 types and API client methods"
```

---

## Task 2: System Layout + Sidebar

**Files:**
- Create: `nexus/src/app/dashboard/system/layout.tsx`
- Modify: `nexus/src/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Create the system layout with node context**

Create `nexus/src/app/dashboard/system/layout.tsx`:

```tsx
'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { useNodes } from '@/hooks/use-cluster';
import { Loader2 } from 'lucide-react';

interface SystemNodeContextValue {
  node: string;
  setNode: (n: string) => void;
}

export const SystemNodeContext = createContext<SystemNodeContextValue>({
  node: '',
  setNode: () => {},
});

export function useSystemNode() {
  return useContext(SystemNodeContext);
}

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  const { data: nodes, isLoading } = useNodes();
  const [node, setNode] = useState('');

  useEffect(() => {
    if (!node && nodes && nodes.length > 0) {
      const first = nodes.find((n) => n.status === 'online') ?? nodes[0];
      setNode(first.node ?? first.id ?? '');
    }
  }, [nodes, node]);

  return (
    <SystemNodeContext.Provider value={{ node, setNode }}>
      <div className="p-6 space-y-6">
        {/* Node selector header */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 shrink-0">Node:</span>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
          ) : (
            <select
              value={node}
              onChange={(e) => setNode(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            >
              {nodes?.map((n) => {
                const name = n.node ?? n.id ?? '';
                return (
                  <option key={name} value={name}>
                    {name} {n.status !== 'online' ? '(offline)' : ''}
                  </option>
                );
              })}
            </select>
          )}
        </div>
        {children}
      </div>
    </SystemNodeContext.Provider>
  );
}
```

- [ ] **Step 2: Update sidebar to add System nav group**

Open `nexus/src/components/dashboard/sidebar.tsx`. Replace the existing `nav` array and add a System group:

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Server,
  LayoutDashboard,
  Terminal,
  Code2,
  LogOut,
  ChevronRight,
  Activity,
  HardDrive,
  Monitor,
  Box,
  Settings,
  Zap,
  Package,
  Network,
  ShieldCheck,
  ScrollText,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/nodes', label: 'Nodes', icon: Server },
  { href: '/dashboard/vms', label: 'Virtual Machines', icon: Monitor },
  { href: '/dashboard/cts', label: 'Containers', icon: Box },
  { href: '/dashboard/storage', label: 'Storage', icon: HardDrive },
  { href: '/dashboard/tasks', label: 'Tasks', icon: Activity },
  { href: '/console', label: 'Console', icon: Terminal },
  { href: '/scripts', label: 'Community Scripts', icon: Code2 },
];

const systemNav = [
  { href: '/dashboard/system/power', label: 'Power', icon: Zap },
  { href: '/dashboard/system/packages', label: 'Packages', icon: Package },
  { href: '/dashboard/system/network', label: 'Network', icon: Network },
  { href: '/dashboard/system/certificates', label: 'Certificates', icon: ShieldCheck },
  { href: '/dashboard/system/logs', label: 'Logs', icon: ScrollText },
];

interface SidebarProps {
  username?: string;
}

export function Sidebar({ username }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const systemActive = pathname.startsWith('/dashboard/system');

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-gray-800">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shrink-0">
          <Server className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="text-sm font-semibold text-white">Nexus</span>
          <p className="text-xs text-gray-500">Proxmox UI</p>
        </div>
      </div>

      {/* CMD+K hint */}
      <div className="px-3 py-3 border-b border-gray-800">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-750 rounded-lg text-xs text-gray-500 transition cursor-pointer"
        >
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-gray-600 font-mono">⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition group',
                active
                  ? 'bg-orange-500/10 text-orange-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="w-3 h-3 opacity-60" />}
            </Link>
          );
        })}

        {/* System group */}
        <div>
          <Link
            href="/dashboard/system/power"
            className={cn(
              'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition w-full',
              systemActive
                ? 'bg-orange-500/10 text-orange-400'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
            )}
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span className="flex-1">System</span>
            <ChevronDown className={cn('w-3 h-3 opacity-60 transition-transform', systemActive && 'rotate-180')} />
          </Link>

          {systemActive && (
            <div className="ml-3 pl-3 border-l border-gray-800 mt-0.5 space-y-0.5">
              {systemNav.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition',
                      active
                        ? 'bg-orange-500/10 text-orange-400'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* User */}
      <div className="border-t border-gray-800 p-3">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-orange-400">
              {username?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-300 truncate">{username ?? 'Unknown'}</p>
            <p className="text-xs text-gray-600">Proxmox</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-gray-600 hover:text-red-400 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd nexus && git add src/app/dashboard/system/layout.tsx src/components/dashboard/sidebar.tsx
git commit -m "feat(system): add system layout with node context and sidebar nav group"
```

---

## Task 3: Power Page

**Files:**
- Create: `nexus/src/app/dashboard/system/power/page.tsx`

- [ ] **Step 1: Create the power page**

Create `nexus/src/app/dashboard/system/power/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/layout';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { formatUptime } from '@/lib/utils';
import { Zap, PowerOff, RotateCcw, Loader2, Clock } from 'lucide-react';

export default function PowerPage() {
  const { node } = useSystemNode();
  const [pending, setPending] = useState<'reboot' | 'shutdown' | null>(null);
  const [toast, setToast] = useState('');

  const { data: status } = useQuery({
    queryKey: ['node', node, 'status'],
    queryFn: () => api.nodes.status(node),
    enabled: !!node,
    refetchInterval: 10_000,
  });

  const powerM = useMutation({
    mutationFn: (command: 'reboot' | 'shutdown') => api.nodes.power(node, command),
    onSuccess: (_, command) => {
      setPending(null);
      setToast(`${command === 'reboot' ? 'Reboot' : 'Shutdown'} initiated for ${node}`);
      setTimeout(() => setToast(''), 5000);
    },
  });

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to manage power.
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 border border-gray-700 text-gray-200 text-sm px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={`${pending === 'reboot' ? 'Reboot' : 'Shut down'} ${node}?`}
          message={
            pending === 'reboot'
              ? `This will reboot node "${node}". All running VMs and containers will be affected.`
              : `This will shut down node "${node}". All running VMs and containers will be stopped.`
          }
          danger={pending === 'shutdown'}
          onConfirm={() => powerM.mutate(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      <div>
        <h1 className="text-xl font-semibold text-white">Power</h1>
        <p className="text-sm text-gray-500">Reboot or shut down node {node}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        {/* Uptime card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-500" />
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Uptime</span>
          </div>
          <p className="text-lg font-mono text-white">
            {status ? formatUptime(status.uptime ?? 0) : '—'}
          </p>
          <p className="text-xs text-gray-600 mt-1">{status?.pveversion ?? ''}</p>
        </div>

        {/* Reboot card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <RotateCcw className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Reboot</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">Restart the node OS. VMs will be suspended or stopped depending on guest agent support.</p>
          <button
            onClick={() => setPending('reboot')}
            disabled={powerM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm rounded-lg transition disabled:opacity-40"
          >
            {powerM.isPending && pending === 'reboot' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            Reboot Node
          </button>
        </div>

        {/* Shutdown card */}
        <div className="bg-gray-900 border border-red-900/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <PowerOff className="w-4 h-4 text-red-400" />
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Shutdown</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">Power off the node completely. Requires physical or IPMI access to bring it back online.</p>
          <button
            onClick={() => setPending('shutdown')}
            disabled={powerM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-lg transition disabled:opacity-40"
          >
            {powerM.isPending && pending === 'shutdown' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <PowerOff className="w-4 h-4" />
            )}
            Shut Down Node
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Extract `ConfirmDialog` to a shared component**

The `ConfirmDialog` component is currently inlined in `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx` (lines ~42-72). Extract it to `nexus/src/components/dashboard/confirm-dialog.tsx`:

```tsx
'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className={cn('w-5 h-5 mt-0.5 shrink-0', danger ? 'text-red-400' : 'text-yellow-400')} />
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-sm text-gray-400 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition text-white',
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600',
            )}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
```

Then in `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx`, remove the inline `ConfirmDialog` definition (lines ~41-72) and replace its import with:

```ts
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
```

Do the same for `nexus/src/app/dashboard/cts/[node]/[vmid]/page.tsx` — find and remove the inline `ConfirmDialog` and add the same import.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd nexus && git add src/app/dashboard/system/power/page.tsx src/components/dashboard/confirm-dialog.tsx src/app/dashboard/vms/[node]/[vmid]/page.tsx src/app/dashboard/cts/[node]/[vmid]/page.tsx
git commit -m "feat(system): add power page and extract ConfirmDialog to shared component"
```

---

## Task 4: Packages Page

**Files:**
- Create: `nexus/src/app/dashboard/system/packages/page.tsx`

- [ ] **Step 1: Create the packages page**

Create `nexus/src/app/dashboard/system/packages/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/layout';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, ArrowUpCircle, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AptPackage } from '@/types/proxmox';

type Tab = 'pve' | 'system';

export default function PackagesPage() {
  const { node } = useSystemNode();
  const [tab, setTab] = useState<Tab>('pve');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taskUpid, setTaskUpid] = useState('');
  const qc = useQueryClient();

  const { data: pvePackages, isLoading: pveLoading, refetch: refetchPve } = useQuery({
    queryKey: ['apt', 'versions', node],
    queryFn: () => api.apt.versions(node),
    enabled: !!node && tab === 'pve',
  });

  const { data: upgradable, isLoading: sysLoading, refetch: refetchSys } = useQuery({
    queryKey: ['apt', 'upgradable', node],
    queryFn: () => api.apt.upgradable(node),
    enabled: !!node && tab === 'system',
  });

  const refreshM = useMutation({
    mutationFn: () => api.apt.update(node),
    onSuccess: (upid) => {
      setTaskUpid(upid);
      setTimeout(() => {
        refetchPve();
        refetchSys();
      }, 3000);
    },
  });

  const installM = useMutation({
    mutationFn: (packages: string[]) => api.apt.install(node, packages),
    onSuccess: (upid) => {
      setTaskUpid(upid);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['apt'] });
    },
  });

  const pveUpgradable = pvePackages?.filter((p) => p.new_version) ?? [];

  const filteredSystem = (upgradable ?? []).filter(
    (p) =>
      !search ||
      p.package.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleSelect = (pkg: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(pkg) ? next.delete(pkg) : next.add(pkg);
      return next;
    });
  };

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to manage packages.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Packages</h1>
          <p className="text-sm text-gray-500">Manage apt packages on {node}</p>
        </div>
        <button
          onClick={() => refreshM.mutate()}
          disabled={refreshM.isPending}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition disabled:opacity-40"
        >
          {refreshM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh Cache
        </button>
      </div>

      {taskUpid && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs px-4 py-2 rounded-lg">
          Task queued: <span className="font-mono">{taskUpid}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 mt-2">
        {(['pve', 'system'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px',
              tab === t
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {t === 'pve' ? 'PVE Packages' : 'System Packages'}
          </button>
        ))}
      </div>

      {/* PVE tab */}
      {tab === 'pve' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              {pveUpgradable.length > 0
                ? `${pveUpgradable.length} update${pveUpgradable.length !== 1 ? 's' : ''} available`
                : 'All PVE packages up to date'}
            </p>
            {pveUpgradable.length > 0 && (
              <button
                onClick={() => installM.mutate([])}
                disabled={installM.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
              >
                {installM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                Upgrade All PVE
              </button>
            )}
          </div>

          {pveLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Package</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Current</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {(pvePackages ?? []).map((pkg) => (
                    <tr key={pkg.package} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5 font-mono text-gray-200">{pkg.package}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{pkg.version}</td>
                      <td className="px-4 py-2.5">
                        {pkg.new_version ? (
                          <Badge variant="warning" className="font-mono text-xs">{pkg.new_version}</Badge>
                        ) : (
                          <Badge variant="success" className="text-xs">current</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* System tab */}
      {tab === 'system' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packages…"
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => installM.mutate(Array.from(selected))}
                disabled={selected.size === 0 || installM.isPending}
                className="px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-sm rounded-lg transition disabled:opacity-40"
              >
                Upgrade Selected ({selected.size})
              </button>
              <button
                onClick={() => installM.mutate([])}
                disabled={installM.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
              >
                {installM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                Upgrade All
              </button>
            </div>
          </div>

          {sysLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          ) : filteredSystem.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 gap-2">
              <Package className="w-6 h-6" />
              <p className="text-sm">{search ? 'No matching packages' : 'All system packages up to date'}</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-4 py-2.5 w-8" />
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Package</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Current</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Available</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Section</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSystem.map((pkg) => (
                    <tr key={pkg.package} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(pkg.package)}
                          onChange={() => toggleSelect(pkg.package)}
                          className="rounded border-gray-600"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-200">{pkg.package}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{pkg.version}</td>
                      <td className="px-4 py-2.5 font-mono text-orange-400 text-xs">{pkg.new_version ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{pkg.section ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd nexus && git add src/app/dashboard/system/packages/page.tsx
git commit -m "feat(system): add packages page with PVE and system apt management"
```

---

## Task 5: Network Config Page

**Files:**
- Create: `nexus/src/app/dashboard/system/network/page.tsx`

- [ ] **Step 1: Create the network config page**

Create `nexus/src/app/dashboard/system/network/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/layout';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Save, AlertTriangle, CheckCircle, RotateCcw, Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NetworkIface, NetworkIfaceParams } from '@/types/proxmox';

type IfaceType = 'bridge' | 'bond' | 'vlan' | 'eth';

const TYPE_COLORS: Record<string, 'success' | 'warning' | 'outline' | 'danger'> = {
  bridge: 'success',
  bond: 'warning',
  OVSBridge: 'outline',
  OVSBond: 'outline',
  eth: 'outline',
  vlan: 'outline',
};

function IfaceForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<NetworkIfaceParams & { iface: string }>;
  onSave: (params: NetworkIfaceParams & { iface: string }) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [type, setType] = useState<IfaceType>((initial?.type as IfaceType) ?? 'bridge');
  const [iface, setIface] = useState(initial?.iface ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [netmask, setNetmask] = useState(initial?.netmask ?? '');
  const [gateway, setGateway] = useState(initial?.gateway ?? '');
  const [autostart, setAutostart] = useState(initial?.autostart ?? 1);
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [bridgePorts, setBridgePorts] = useState(initial?.bridge_ports ?? '');
  const [bondMode, setBondMode] = useState(initial?.bond_mode ?? 'active-backup');
  const [slaves, setSlaves] = useState(initial?.slaves ?? '');
  const [vlanDev, setVlanDev] = useState(initial?.['vlan-raw-device'] ?? '');
  const [vlanId, setVlanId] = useState(String(initial?.['vlan-id'] ?? ''));

  const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';
  const labelCls = 'text-xs text-gray-500 block mb-1';

  function handleSave() {
    const params: NetworkIfaceParams & { iface: string } = { type, iface, address, netmask, gateway, autostart, comments };
    if (type === 'bridge') { params.bridge_ports = bridgePorts; params.bridge_stp = 'off'; params.bridge_fd = 0; }
    if (type === 'bond') { params.bond_mode = bondMode; params.slaves = slaves; }
    if (type === 'vlan') { params['vlan-raw-device'] = vlanDev; params['vlan-id'] = Number(vlanId); }
    onSave(params);
  }

  return (
    <div className="space-y-3">
      {!initial?.iface && (
        <>
          <div>
            <label className={labelCls}>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as IfaceType)} className={inputCls}>
              <option value="bridge">Bridge</option>
              <option value="bond">Bond</option>
              <option value="vlan">VLAN</option>
              <option value="eth">Ethernet</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Interface Name</label>
            <input value={iface} onChange={(e) => setIface(e.target.value)} placeholder="e.g. vmbr1" className={inputCls} />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>IP Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.10" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Netmask</label>
          <input value={netmask} onChange={(e) => setNetmask(e.target.value)} placeholder="255.255.255.0" className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Gateway</label>
        <input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="192.168.1.1" className={inputCls} />
      </div>

      {type === 'bridge' && (
        <div>
          <label className={labelCls}>Bridge Ports</label>
          <input value={bridgePorts} onChange={(e) => setBridgePorts(e.target.value)} placeholder="e.g. eth0" className={inputCls} />
        </div>
      )}

      {type === 'bond' && (
        <>
          <div>
            <label className={labelCls}>Slaves</label>
            <input value={slaves} onChange={(e) => setSlaves(e.target.value)} placeholder="e.g. eth0 eth1" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Bond Mode</label>
            <select value={bondMode} onChange={(e) => setBondMode(e.target.value)} className={inputCls}>
              <option value="active-backup">active-backup</option>
              <option value="balance-rr">balance-rr</option>
              <option value="balance-xor">balance-xor</option>
              <option value="802.3ad">802.3ad (LACP)</option>
              <option value="balance-tlb">balance-tlb</option>
              <option value="balance-alb">balance-alb</option>
            </select>
          </div>
        </>
      )}

      {type === 'vlan' && (
        <>
          <div>
            <label className={labelCls}>Raw Device</label>
            <input value={vlanDev} onChange={(e) => setVlanDev(e.target.value)} placeholder="e.g. eth0" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>VLAN Tag</label>
            <input type="number" value={vlanId} onChange={(e) => setVlanId(e.target.value)} placeholder="e.g. 100" className={inputCls} />
          </div>
        </>
      )}

      <div>
        <label className={labelCls}>Comments</label>
        <input value={comments} onChange={(e) => setComments(e.target.value)} className={inputCls} />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="checkbox" checked={autostart === 1} onChange={(e) => setAutostart(e.target.checked ? 1 : 0)} className="rounded border-gray-600" />
        Autostart on boot
      </label>

      <div className="flex gap-3 justify-end pt-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving || (!initial?.iface && !iface)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-40"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
      </div>
    </div>
  );
}

export default function NetworkPage() {
  const { node } = useSystemNode();
  const qc = useQueryClient();
  const [selectedIface, setSelectedIface] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editing, setEditing] = useState(false);

  const { data: networkData, isLoading } = useQuery({
    queryKey: ['network', node],
    queryFn: () => api.networkIfaces.list(node),
    enabled: !!node,
    refetchInterval: 15_000,
  });

  const ifaces = (networkData as unknown as NetworkIface[]) ?? [];
  const hasPendingChanges = typeof networkData === 'object' && networkData !== null &&
    'changes' in networkData && !!(networkData as { changes?: string }).changes;

  const selected = ifaces.find((i) => i.iface === selectedIface);

  const createM = useMutation({
    mutationFn: (params: NetworkIfaceParams) => api.networkIfaces.create(node, params),
    onSuccess: () => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['network', node] }); },
  });

  const updateM = useMutation({
    mutationFn: (params: Partial<NetworkIfaceParams>) =>
      api.networkIfaces.update(node, selectedIface!, params),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['network', node] }); },
  });

  const deleteM = useMutation({
    mutationFn: () => api.networkIfaces.delete(node, selectedIface!),
    onSuccess: () => { setSelectedIface(null); setShowDeleteConfirm(false); qc.invalidateQueries({ queryKey: ['network', node] }); },
  });

  const applyM = useMutation({
    mutationFn: () => api.networkIfaces.apply(node),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', node] }),
  });

  const revertM = useMutation({
    mutationFn: () => api.networkIfaces.revert(node),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', node] }),
  });

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to manage network interfaces.
      </div>
    );
  }

  return (
    <>
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${selectedIface}?`}
          message={`This will remove interface "${selectedIface}" from the configuration. Apply changes to take effect.`}
          danger
          onConfirm={() => deleteM.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Network</h1>
          <p className="text-sm text-gray-500">Manage interfaces on {node}</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setSelectedIface(null); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          New Interface
        </button>
      </div>

      {hasPendingChanges && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-300 flex-1">Pending network changes — not yet applied to the system.</p>
          <div className="flex gap-2">
            <button
              onClick={() => revertM.mutate()}
              disabled={revertM.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition"
            >
              {revertM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Revert
            </button>
            <button
              onClick={() => applyM.mutate()}
              disabled={applyM.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-yellow-600 hover:bg-yellow-500 rounded-lg transition"
            >
              {applyM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              Apply Configuration
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[260px_1fr] gap-4">
        {/* Interface list */}
        <div className="space-y-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          ) : (
            ifaces.map((iface) => (
              <button
                key={iface.iface}
                onClick={() => { setSelectedIface(iface.iface); setEditing(false); setShowCreate(false); }}
                className={cn(
                  'w-full text-left bg-gray-900 border rounded-xl p-3 transition',
                  selectedIface === iface.iface ? 'border-orange-500/50' : 'border-gray-800 hover:border-gray-700',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', iface.active ? 'bg-emerald-400' : 'bg-gray-600')} />
                  <span className="text-sm font-mono text-gray-200 font-medium">{iface.iface}</span>
                  <Badge variant={TYPE_COLORS[iface.type] ?? 'outline'} className="ml-auto text-xs">{iface.type}</Badge>
                </div>
                {iface.address && <p className="text-xs text-gray-500 font-mono pl-3.5">{iface.cidr ?? iface.address}</p>}
              </button>
            ))
          )}
        </div>

        {/* Detail / create panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          {showCreate ? (
            <>
              <h3 className="text-sm font-semibold text-white mb-4">New Interface</h3>
              <IfaceForm
                onSave={(params) => createM.mutate(params)}
                onCancel={() => setShowCreate(false)}
                isSaving={createM.isPending}
              />
            </>
          ) : selected && !editing ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white font-mono">{selected.iface}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-gray-800 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  ['Type', selected.type],
                  ['Status', selected.active ? 'Active' : 'Inactive'],
                  ['Autostart', selected.autostart ? 'Yes' : 'No'],
                  ['IP Address', selected.cidr ?? selected.address ?? '—'],
                  ['Netmask', selected.netmask ?? '—'],
                  ['Gateway', selected.gateway ?? '—'],
                  ['Bridge Ports', selected.bridge_ports ?? '—'],
                  ['Bond Mode', selected.bond_mode ?? '—'],
                  ['Comments', selected.comments ?? '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="text-gray-200 font-mono text-xs mt-0.5">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : selected && editing ? (
            <>
              <h3 className="text-sm font-semibold text-white mb-4">Edit {selected.iface}</h3>
              <IfaceForm
                initial={{
                  iface: selected.iface,
                  type: selected.type as IfaceType,
                  address: selected.address,
                  netmask: selected.netmask,
                  gateway: selected.gateway,
                  autostart: selected.autostart,
                  comments: selected.comments,
                  bridge_ports: selected.bridge_ports,
                  bond_mode: selected.bond_mode,
                  'vlan-raw-device': selected['vlan-raw-device'],
                  'vlan-id': selected['vlan-id'],
                }}
                onSave={(params) => updateM.mutate(params)}
                onCancel={() => setEditing(false)}
                isSaving={updateM.isPending}
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
              <Network className="w-8 h-8" />
              <p className="text-sm">Select an interface or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd nexus && git add src/app/dashboard/system/network/page.tsx
git commit -m "feat(system): add network config page with full interface CRUD"
```

---

## Task 6: Certificates & Tunnels Page

**Files:**
- Create: `nexus/src/app/dashboard/system/certificates/page.tsx`

- [ ] **Step 1: Create the certificates page**

Create `nexus/src/app/dashboard/system/certificates/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/layout';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, AlertTriangle, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CertificateInfo } from '@/types/proxmox';

type Tab = 'current' | 'acme' | 'tunnels';

function daysUntil(ts?: number): number | null {
  if (!ts) return null;
  return Math.floor((ts * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
}

function CertBadge({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days < 7) return <Badge variant="danger">{days}d left</Badge>;
  if (days < 30) return <Badge variant="warning">{days}d left</Badge>;
  return <Badge variant="success">{days}d left</Badge>;
}

const TUNNEL_PROVIDERS = [
  {
    id: 'cloudflared',
    name: 'Cloudflare Tunnel',
    binary: 'cloudflared',
    service: 'cloudflared',
    installCmd: 'curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" | tee /etc/apt/sources.list.d/cloudflared.list && apt-get update && apt-get install -y cloudflared',
    configFields: [{ key: 'token', label: 'Tunnel Token', placeholder: 'eyJhIjoi...' }],
    configCmd: (vals: Record<string, string>) =>
      `cloudflared service install ${vals.token}`,
  },
  {
    id: 'ngrok',
    name: 'ngrok',
    binary: 'ngrok',
    service: 'ngrok',
    installCmd: 'curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | tee /etc/apt/sources.list.d/ngrok.list && apt-get update && apt-get install -y ngrok',
    configFields: [
      { key: 'authtoken', label: 'Auth Token', placeholder: '2abc...' },
      { key: 'port', label: 'Local Port', placeholder: '8080' },
    ],
    configCmd: (vals: Record<string, string>) =>
      `ngrok config add-authtoken ${vals.authtoken} && ngrok http ${vals.port ?? '8080'} --log=stdout &`,
  },
];

function TunnelCard({ node, provider }: { node: string; provider: typeof TUNNEL_PROVIDERS[number] }) {
  const qc = useQueryClient();
  const [configVals, setConfigVals] = useState<Record<string, string>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [output, setOutput] = useState('');

  const { data: checkData } = useQuery({
    queryKey: ['tunnel', node, provider.id, 'check'],
    queryFn: () => api.exec.shellCmd(node, `which ${provider.binary} && systemctl is-active ${provider.service} 2>/dev/null || echo inactive`),
    enabled: !!node,
    refetchInterval: 10_000,
  });

  const installed = typeof checkData === 'string' && checkData.includes('/');
  const active = typeof checkData === 'string' && checkData.includes('active');

  const execM = useMutation({
    mutationFn: (cmd: string) => api.exec.shellCmd(node, cmd),
    onSuccess: (result) => {
      setOutput(typeof result === 'string' ? result : JSON.stringify(result));
      qc.invalidateQueries({ queryKey: ['tunnel', node, provider.id] });
    },
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-white">{provider.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {installed ? (
            <Badge variant={active ? 'success' : 'outline'}>{active ? 'Running' : 'Installed'}</Badge>
          ) : (
            <Badge variant="danger">Not Installed</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!installed && (
          <button
            onClick={() => execM.mutate(provider.installCmd)}
            disabled={execM.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg transition disabled:opacity-40"
          >
            {execM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Install
          </button>
        )}
        {installed && (
          <>
            <button
              onClick={() => execM.mutate(`systemctl ${active ? 'stop' : 'start'} ${provider.service}`)}
              disabled={execM.isPending}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition disabled:opacity-40"
            >
              {active ? 'Stop' : 'Start'}
            </button>
            <button
              onClick={() => execM.mutate(`systemctl ${active ? 'disable' : 'enable'} ${provider.service}`)}
              disabled={execM.isPending}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition disabled:opacity-40"
            >
              {active ? 'Disable autostart' : 'Enable autostart'}
            </button>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition"
            >
              Configure
            </button>
          </>
        )}
      </div>

      {showConfig && (
        <div className="space-y-2 pt-2 border-t border-gray-800">
          {provider.configFields.map((field) => (
            <div key={field.key}>
              <label className="text-xs text-gray-500 block mb-1">{field.label}</label>
              <input
                value={configVals[field.key] ?? ''}
                onChange={(e) => setConfigVals((p) => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
              />
            </div>
          ))}
          <button
            onClick={() => execM.mutate(provider.configCmd(configVals))}
            disabled={execM.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg transition disabled:opacity-40"
          >
            {execM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Apply Config
          </button>
        </div>
      )}

      {output && (
        <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-32">
          {output}
        </pre>
      )}
    </div>
  );
}

export default function CertificatesPage() {
  const { node } = useSystemNode();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('current');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [acmeEmail, setAcmeEmail] = useState('');
  const [acmeDomain, setAcmeDomain] = useState('');
  const [taskUpid, setTaskUpid] = useState('');

  const { data: certs, isLoading } = useQuery({
    queryKey: ['certificates', node],
    queryFn: () => api.certificates.list(node),
    enabled: !!node,
  });

  const { data: acmeAccounts } = useQuery({
    queryKey: ['acme', 'accounts'],
    queryFn: () => api.acme.accounts(),
    enabled: !!node && tab === 'acme',
  });

  const uploadM = useMutation({
    mutationFn: () => api.certificates.uploadCustom(node, certPem, keyPem),
    onSuccess: () => {
      setCertPem('');
      setKeyPem('');
      qc.invalidateQueries({ queryKey: ['certificates', node] });
    },
  });

  const deleteCustomM = useMutation({
    mutationFn: () => api.certificates.deleteCustom(node),
    onSuccess: () => { setShowDeleteConfirm(false); qc.invalidateQueries({ queryKey: ['certificates', node] }); },
  });

  const registerAccountM = useMutation({
    mutationFn: () => api.acme.registerAccount('default', acmeEmail),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acme', 'accounts'] }),
  });

  const orderCertM = useMutation({
    mutationFn: () => api.certificates.orderAcme(node),
    onSuccess: (upid) => setTaskUpid(upid),
  });

  const activeCert = certs?.find((c) => c.filename === 'pveproxy-ssl.pem') ?? certs?.[0];
  const days = daysUntil(activeCert?.notafter);

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to manage certificates.
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';

  return (
    <>
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete custom certificate?"
          message="This will revert to the self-signed Proxmox certificate."
          danger
          onConfirm={() => deleteCustomM.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      <div>
        <h1 className="text-xl font-semibold text-white">Certificates</h1>
        <p className="text-sm text-gray-500">TLS certificates and tunnel providers for {node}</p>
      </div>

      {taskUpid && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs px-4 py-2 rounded-lg">
          Task queued: <span className="font-mono">{taskUpid}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {([['current', 'Current Cert'], ['acme', 'ACME / Let\'s Encrypt'], ['tunnels', 'Tunnel Providers']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px',
              tab === t ? 'border-orange-500 text-orange-400' : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Current cert tab */}
      {tab === 'current' && (
        <div className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
          ) : activeCert ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Active Certificate</h3>
                <CertBadge days={days} />
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ['Subject', activeCert.subject],
                  ['Issuer', activeCert.issuer],
                  ['SANs', activeCert.san?.join(', ')],
                  ['Fingerprint', activeCert.fingerprint],
                  ['Valid Until', activeCert.notafter ? new Date(activeCert.notafter * 1000).toLocaleDateString() : '—'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="text-gray-300 font-mono text-xs mt-0.5 break-all">{val ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs text-red-400 hover:text-red-300 transition"
              >
                Delete custom certificate
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <AlertTriangle className="w-4 h-4" />
              No certificate info available.
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Upload Custom Certificate</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Certificate (PEM)</label>
              <textarea
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                rows={5}
                className={inputCls + ' font-mono text-xs resize-y'}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Private Key (PEM)</label>
              <textarea
                value={keyPem}
                onChange={(e) => setKeyPem(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
                rows={5}
                className={inputCls + ' font-mono text-xs resize-y'}
              />
            </div>
            <button
              onClick={() => uploadM.mutate()}
              disabled={!certPem || !keyPem || uploadM.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
            >
              {uploadM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Upload Certificate
            </button>
          </div>
        </div>
      )}

      {/* ACME tab */}
      {tab === 'acme' && (
        <div className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">ACME Account</h3>
            {acmeAccounts && acmeAccounts.length > 0 ? (
              <div className="space-y-2">
                {acmeAccounts.map((a) => (
                  <div key={a.name} className="flex items-center gap-3">
                    <Badge variant="success">Registered</Badge>
                    <span className="text-sm text-gray-300 font-mono">{a.contact?.join(', ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">No ACME account registered. Register one to enable Let&apos;s Encrypt.</p>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input value={acmeEmail} onChange={(e) => setAcmeEmail(e.target.value)} placeholder="admin@example.com" className={inputCls} />
                </div>
                <button
                  onClick={() => registerAccountM.mutate()}
                  disabled={!acmeEmail || registerAccountM.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
                >
                  {registerAccountM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Register Account
                </button>
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Order Certificate</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Domain (must resolve to this node&apos;s IP)</label>
              <input value={acmeDomain} onChange={(e) => setAcmeDomain(e.target.value)} placeholder="pve.example.com" className={inputCls} />
            </div>
            <button
              onClick={() => orderCertM.mutate()}
              disabled={!acmeDomain || orderCertM.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
            >
              {orderCertM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Order Certificate
            </button>
            <p className="text-xs text-gray-600">The domain must be configured on the node first via the Proxmox ACME domain config before ordering.</p>
          </div>
        </div>
      )}

      {/* Tunnels tab */}
      {tab === 'tunnels' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Install and manage reverse tunnel agents on {node}.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TUNNEL_PROVIDERS.map((p) => (
              <TunnelCard key={p.id} node={node} provider={p} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd nexus && git add src/app/dashboard/system/certificates/page.tsx
git commit -m "feat(system): add certificates page with custom cert upload, ACME, and tunnel providers"
```

---

## Task 7: Logs / Journal Viewer Page

**Files:**
- Create: `nexus/src/app/dashboard/system/logs/page.tsx`

- [ ] **Step 1: Create the logs page**

Create `nexus/src/app/dashboard/system/logs/page.tsx`:

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/layout';
import { Badge } from '@/components/ui/badge';
import { Loader2, ScrollText, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JournalEntry } from '@/types/proxmox';

type Mode = 'table' | 'tail';
type Priority = 'all' | 'err' | 'warning' | 'info';

const PRIORITY_VARIANTS: Record<string, 'danger' | 'warning' | 'outline'> = {
  '0': 'danger', '1': 'danger', '2': 'danger', '3': 'danger',
  emerg: 'danger', alert: 'danger', crit: 'danger', err: 'danger',
  '4': 'warning', warning: 'warning',
  '5': 'outline', '6': 'outline', '7': 'outline',
  notice: 'outline', info: 'outline', debug: 'outline',
};

const PRIORITY_LABELS: Record<string, string> = {
  '0': 'emerg', '1': 'alert', '2': 'crit', '3': 'err',
  '4': 'warn', '5': 'notice', '6': 'info', '7': 'debug',
};

function priorityLabel(p?: string) {
  return p ? (PRIORITY_LABELS[p] ?? p) : 'info';
}

function priorityVariant(p?: string): 'danger' | 'warning' | 'outline' {
  return p ? (PRIORITY_VARIANTS[p] ?? 'outline') : 'outline';
}

function matchesPriorityFilter(entry: JournalEntry, filter: Priority): boolean {
  if (filter === 'all') return true;
  const p = entry.p ?? '6';
  if (filter === 'err') return ['0','1','2','3','emerg','alert','crit','err'].includes(p);
  if (filter === 'warning') return ['0','1','2','3','4','emerg','alert','crit','err','warning'].includes(p);
  return true;
}

export default function LogsPage() {
  const { node } = useSystemNode();
  const [mode, setMode] = useState<Mode>('table');
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority>('all');
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const tailRef = useRef<HTMLPreElement>(null);

  const PAGE_SIZE = 500;

  // Table mode — load entries
  const { data: entries, isLoading } = useQuery({
    queryKey: ['journal', node, page],
    queryFn: () => api.nodes.journal(node, { lastentries: PAGE_SIZE * page }),
    enabled: !!node && mode === 'table',
  });

  // Live tail mode
  const { data: tailEntries } = useQuery({
    queryKey: ['journal', node, 'tail'],
    queryFn: () => api.nodes.journal(node, { lastentries: 100, ...(unitFilter ? { unit: unitFilter } : {}) }),
    enabled: !!node && mode === 'tail' && !paused,
    refetchInterval: 2_000,
  });

  // Auto-scroll tail
  useEffect(() => {
    if (mode === 'tail' && !paused && tailRef.current) {
      tailRef.current.scrollTop = tailRef.current.scrollHeight;
    }
  }, [tailEntries, mode, paused]);

  const allUnits = [...new Set((entries ?? []).map((e) => e.u).filter(Boolean))] as string[];

  const filtered = (entries ?? []).filter((e) => {
    if (!matchesPriorityFilter(e, priorityFilter)) return false;
    if (unitFilter && e.u !== unitFilter) return false;
    if (search && !e.m.toLowerCase().includes(search.toLowerCase()) && !e.u?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to view logs.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Logs</h1>
          <p className="text-sm text-gray-500">System journal for {node}</p>
        </div>
        <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
          {(['table', 'tail'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition',
                mode === m ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300',
              )}
            >
              {m === 'table' ? 'Table' : 'Live Tail'}
            </button>
          ))}
        </div>
      </div>

      {/* Table mode */}
      {mode === 'table' && (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search message or unit…"
              className="flex-1 min-w-48 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            >
              <option value="all">All priorities</option>
              <option value="err">Errors only</option>
              <option value="warning">Warnings+</option>
            </select>
            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            >
              <option value="">All units</option>
              {allUnits.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
          ) : (
            <>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-44">Time</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-32">Unit</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-20">Priority</th>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, PAGE_SIZE * page).map((entry, i) => (
                      <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="px-4 py-1.5 font-mono text-gray-500 whitespace-nowrap">{entry.t}</td>
                        <td className="px-4 py-1.5 font-mono text-gray-400 truncate max-w-[8rem]">{entry.u ?? '—'}</td>
                        <td className="px-4 py-1.5">
                          <Badge variant={priorityVariant(entry.p)} className="text-xs">{priorityLabel(entry.p)}</Badge>
                        </td>
                        <td className="px-4 py-1.5 text-gray-300 break-all">{entry.m}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Showing {Math.min(filtered.length, PAGE_SIZE * page)} of {filtered.length} entries</p>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition"
                >
                  Load More
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Live tail mode */}
      {mode === 'tail' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              placeholder="Filter by unit (e.g. pveproxyd)"
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
            />
            <button
              onClick={() => setPaused((p) => !p)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition',
                paused
                  ? 'bg-orange-500 hover:bg-orange-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300',
              )}
            >
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>

          {tailEntries && tailEntries.length === 0 && !paused && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <ScrollText className="w-4 h-4" />
              No entries. Check unit filter or wait for new log messages.
            </div>
          )}

          <pre
            ref={tailRef}
            className="bg-gray-950 border border-gray-800 rounded-xl p-4 text-xs text-gray-400 font-mono overflow-y-auto h-[28rem] whitespace-pre-wrap"
          >
            {(tailEntries ?? []).map((e, i) => (
              `${e.t}  [${(e.u ?? '').padEnd(20)}]  ${e.m}\n`
            )).join('')}
          </pre>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd nexus && git add src/app/dashboard/system/logs/page.tsx
git commit -m "feat(system): add journal log viewer with table and live tail modes"
```

---

## Task 8: VM/CT Metrics Chart Component

**Files:**
- Create: `nexus/src/components/dashboard/vm-metrics-chart.tsx`

- [ ] **Step 1: Create the VM metrics chart component**

Create `nexus/src/components/dashboard/vm-metrics-chart.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { formatBytes } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

type Timeframe = 'hour' | 'day' | 'week';

interface VMMetricsChartProps {
  node: string;
  vmid: number;
  type: 'qemu' | 'lxc';
}

function formatTime(ts: number, timeframe: Timeframe): string {
  const d = new Date(ts * 1000);
  if (timeframe === 'hour') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timeframe === 'day') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-lg">
      <p className="text-gray-400 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="text-white font-mono">
            {p.name === 'CPU' ? `${(p.value * 100).toFixed(1)}%` : formatBytes(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export function VMMetricsChart({ node, vmid, type }: VMMetricsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('hour');

  const { data, isLoading } = useQuery({
    queryKey: [type === 'qemu' ? 'vm' : 'ct', node, vmid, 'rrd', timeframe],
    queryFn: () =>
      type === 'qemu'
        ? api.vms.rrd(node, vmid, timeframe)
        : api.containers.rrd(node, vmid, timeframe),
    refetchInterval: 30_000,
  });

  const chartData = (data ?? []).map((d) => ({
    time: formatTime(d.time, timeframe),
    CPU: d.cpu ?? 0,
    Memory: d.memused ?? 0,
    'Net In': d.netin ?? 0,
    'Net Out': d.netout ?? 0,
    'Disk Read': d.diskread ?? 0,
    'Disk Write': d.diskwrite ?? 0,
  }));

  const charts: { label: string; keys: string[]; colors: string[]; gradIds: string[]; formatter?: (v: number) => string }[] = [
    {
      label: 'CPU Usage',
      keys: ['CPU'],
      colors: ['#f97316'],
      gradIds: ['vmCpuGrad'],
      formatter: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: 'Memory',
      keys: ['Memory'],
      colors: ['#3b82f6'],
      gradIds: ['vmMemGrad'],
    },
    {
      label: 'Network I/O',
      keys: ['Net In', 'Net Out'],
      colors: ['#10b981', '#8b5cf6'],
      gradIds: ['vmNetInGrad', 'vmNetOutGrad'],
    },
    {
      label: 'Disk I/O',
      keys: ['Disk Read', 'Disk Write'],
      colors: ['#f59e0b', '#ec4899'],
      gradIds: ['vmDiskReadGrad', 'vmDiskWriteGrad'],
    },
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Metrics</h3>
          <p className="text-xs text-gray-500">CPU · Memory · Network · Disk</p>
        </div>
        <div className="flex gap-1">
          {(['hour', 'day', 'week'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                timeframe === tf ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tf === 'hour' ? '1h' : tf === 'day' ? '24h' : '7d'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {charts.map((chart) => (
            <div key={chart.label}>
              <p className="text-xs text-gray-500 mb-2">{chart.label}</p>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    {chart.colors.map((color, i) => (
                      <linearGradient key={chart.gradIds[i]} id={chart.gradIds[i]} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    tickLine={false}
                    tickFormatter={chart.formatter ?? ((v) => formatBytes(v))}
                    domain={chart.keys[0] === 'CPU' ? [0, 1] : undefined}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {chart.keys.map((key, i) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={chart.colors[i]}
                      strokeWidth={1.5}
                      fill={`url(#${chart.gradIds[i]})`}
                      dot={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd nexus && git add src/components/dashboard/vm-metrics-chart.tsx
git commit -m "feat(system): add VMMetricsChart component for per-VM/CT RRD data"
```

---

## Task 9: Add Metrics Tab to VM Detail Page

**Files:**
- Modify: `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx`

- [ ] **Step 1: Add Metrics tab to VM detail page**

Open `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx`.

1. Add import at the top:

```ts
import { VMMetricsChart } from '@/components/dashboard/vm-metrics-chart';
```

2. Find the `tabs` constant (around line 281-284):

```ts
const tabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'hardware', label: 'Hardware' },
] as const;
```

Replace with:

```ts
const tabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'metrics', label: 'Metrics' },
] as const;
```

3. Find the `useState` for `tab`:

```ts
const [tab, setTab] = useState<'summary' | 'hardware'>('summary');
```

Replace with:

```ts
const [tab, setTab] = useState<'summary' | 'hardware' | 'metrics'>('summary');
```

4. Find the section in the JSX that renders tab content based on `tab`. It will have conditional blocks like `{tab === 'summary' && (...)}` and `{tab === 'hardware' && (...)}`. After the hardware block, add:

```tsx
{tab === 'metrics' && (
  <VMMetricsChart node={node} vmid={vmid} type="qemu" />
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd nexus && git add src/app/dashboard/vms/[node]/[vmid]/page.tsx
git commit -m "feat(system): add Metrics tab to VM detail page"
```

---

## Task 10: Add Metrics Tab to CT Detail Page

**Files:**
- Modify: `nexus/src/app/dashboard/cts/[node]/[vmid]/page.tsx`

- [ ] **Step 1: Add Metrics tab to CT detail page**

Open `nexus/src/app/dashboard/cts/[node]/[vmid]/page.tsx`.

1. Add import at the top:

```ts
import { VMMetricsChart } from '@/components/dashboard/vm-metrics-chart';
```

2. Find the `tabs` constant (around line 205):

```ts
const tabs = [{ id: 'summary', label: 'Summary' }, { id: 'hardware', label: 'Hardware' }] as const;
```

Replace with:

```ts
const tabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'metrics', label: 'Metrics' },
] as const;
```

3. Find the `useState` for `tab` and update the type union to include `'metrics'`:

```ts
const [tab, setTab] = useState<'summary' | 'hardware' | 'metrics'>('summary');
```

4. After the hardware tab block in JSX, add:

```tsx
{tab === 'metrics' && (
  <VMMetricsChart node={node} vmid={vmid} type="lxc" />
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd nexus && git add src/app/dashboard/cts/[node]/[vmid]/page.tsx
git commit -m "feat(system): add Metrics tab to CT detail page"
```

---

## Task 11: Final Build Verification

- [ ] **Step 1: Run full Next.js build**

```bash
cd nexus && npm run build
```

Expected: Build completes successfully with no TypeScript errors. Note: Proxmox API calls will not resolve at build time — that is expected. What must not appear: type errors, missing module errors, or import resolution failures.

- [ ] **Step 2: Commit if any build-time fixes were needed**

```bash
cd nexus && git add -A
git commit -m "fix: resolve any build-time issues from Tier 4 System implementation"
```

Only create this commit if step 1 produced errors that required fixes.

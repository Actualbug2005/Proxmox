# Audit-Driven Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps surfaced by the end-to-end audit: add global toast feedback, honour console query params, confirm destructive network ops, allow pausing the tasks feed, and wire up a graphical (noVNC) console entry point.

**Architecture:** One small cross-cutting primitive (toast provider + hook) replaces the hand-rolled inline toasts already scattered across pages. Every remaining mutation gets `onSuccess`/`onError` handlers that push toasts. Console page reads URL query params to preselect the tab. Network apply/revert wraps in ConfirmDialog. Tasks page gets a pause toggle. A new `/console/vnc/[...params]` helper route opens PVE's native vnc.html in a new window. No new npm dependencies.

**Tech Stack:** Next.js 16 App Router, React 18, TanStack Query, Tailwind CSS, TypeScript, Proxmox VE REST API.

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `nexus/src/components/ui/toast.tsx` | Toast provider + `useToast()` hook + `<Toaster/>` component |
| `nexus/src/app/console/vnc/page.tsx` | Redirect helper that opens PVE's native vnc.html for a VM/CT |

### Modified files
| Path | Change |
|------|--------|
| `nexus/src/app/layout.tsx` | Mount `<Toaster/>` inside `<Providers>` |
| `nexus/src/components/providers.tsx` | Wrap children with `<ToastProvider>` |
| `nexus/src/components/dashboard/command-palette.tsx` | Push error toast in `handleVMAction` catch |
| `nexus/src/app/dashboard/system/power/page.tsx` | Replace local toast state with `useToast()` |
| `nexus/src/app/dashboard/system/packages/page.tsx` | `installM`/`refreshM` `onSuccess`+`onError` toasts |
| `nexus/src/app/dashboard/system/certificates/page.tsx` | `execM`, `uploadM`, `orderCertM`, `registerAccountM` toasts |
| `nexus/src/app/dashboard/system/network/page.tsx` | ConfirmDialog before apply/revert, toasts on all mutations |
| `nexus/src/app/scripts/page.tsx` | Toast on script execution failure (persistent) |
| `nexus/src/app/console/page.tsx` | Read `node`/`vmid`/`type` from query, auto-open tab |
| `nexus/src/app/dashboard/tasks/page.tsx` | Pause/resume toggle that flips `refetchInterval` |
| `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx` | "Graphical Console" button → `/console/vnc?...` |
| `nexus/src/app/dashboard/cts/[node]/[vmid]/page.tsx` | Same button for containers |

---

## Task 1: Global Toast System

**Files:**
- Create: `nexus/src/components/ui/toast.tsx`
- Modify: `nexus/src/components/providers.tsx`

- [ ] **Step 1: Create the toast module**

Create `nexus/src/components/ui/toast.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, ...t }]);
  }, []);

  const value: ToastContextValue = {
    push,
    success: (title, message) => push({ variant: 'success', title, message }),
    error: (title, message) => push({ variant: 'error', title, message }),
    info: (title, message) => push({ variant: 'info', title, message }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster items={items} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

function Toaster({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <ToastView key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, item.variant === 'error' ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [item.variant, onDismiss]);

  const Icon = item.variant === 'success' ? CheckCircle2 : item.variant === 'error' ? AlertCircle : Info;
  const tone =
    item.variant === 'success'
      ? 'border-emerald-500/30 text-emerald-300'
      : item.variant === 'error'
        ? 'border-red-500/30 text-red-300'
        : 'border-blue-500/30 text-blue-300';

  return (
    <div
      className={cn(
        'pointer-events-auto min-w-72 max-w-sm bg-gray-900 border rounded-xl shadow-2xl px-4 py-3 flex items-start gap-3',
        tone,
      )}
      role="status"
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{item.title}</p>
        {item.message && <p className="text-xs text-gray-400 mt-0.5 break-words">{item.message}</p>}
      </div>
      <button
        onClick={onDismiss}
        className="text-gray-500 hover:text-gray-200 transition shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wrap `<Providers>` with `<ToastProvider>`**

Open `nexus/src/components/providers.tsx`, add the import at top:

```tsx
import { ToastProvider } from '@/components/ui/toast';
```

Find the existing return (which wraps `QueryClientProvider`), and insert `<ToastProvider>` as the outermost client wrapper inside the providers. The resulting JSX should look like:

```tsx
return (
  <QueryClientProvider client={queryClient}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/components/ui/toast.tsx src/components/providers.tsx && git commit -m "feat(ui): add global toast provider and hook"
```

---

## Task 2: Wire Toast into Command Palette

**Files:**
- Modify: `nexus/src/components/dashboard/command-palette.tsx`

- [ ] **Step 1: Replace silent catch with toast feedback**

In `nexus/src/components/dashboard/command-palette.tsx`:

Add this import with the others:
```tsx
import { useToast } from '@/components/ui/toast';
```

Inside `CommandPalette()` component, add right after `const { data: resources } = useClusterResources();`:
```tsx
const toast = useToast();
```

Replace the entire `handleVMAction` function (lines ~56-76) with:

```tsx
async function handleVMAction(
  action: 'start' | 'stop' | 'reboot',
  node: string,
  vmid: number,
  type: 'vm' | 'lxc',
) {
  setOpen(false);
  try {
    if (type === 'vm') {
      if (action === 'start') await api.vms.start(node, vmid);
      if (action === 'stop') await api.vms.stop(node, vmid);
      if (action === 'reboot') await api.vms.reboot(node, vmid);
    } else {
      if (action === 'start') await api.containers.start(node, vmid);
      if (action === 'stop') await api.containers.stop(node, vmid);
      if (action === 'reboot') await api.containers.reboot(node, vmid);
    }
    toast.success(`${action[0].toUpperCase() + action.slice(1)} queued`, `${type.toUpperCase()} ${vmid}`);
  } catch (err) {
    toast.error(`Failed to ${action}`, err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/components/dashboard/command-palette.tsx && git commit -m "fix(command-palette): surface VM/CT action errors via toast"
```

---

## Task 3: Replace Power Page hand-rolled toast

**Files:**
- Modify: `nexus/src/app/dashboard/system/power/page.tsx`

- [ ] **Step 1: Swap local toast state for `useToast()`**

Read the current file first. Then:

Add this import near the top:
```tsx
import { useToast } from '@/components/ui/toast';
```

Inside the component, replace the local `const [toast, setToast] = useState('');` state and the hand-rolled `<div>` toast element at the top of the JSX. Instead:

- Add `const toast = useToast();` near the other hooks
- In the `powerM` mutation, replace the `onSuccess` body:
  ```tsx
  onSuccess: (_, command) => {
    setPending(null);
    toast.success(
      `${command === 'reboot' ? 'Reboot' : 'Shutdown'} initiated`,
      `Node ${node} will ${command === 'reboot' ? 'restart' : 'power off'} shortly.`,
    );
  },
  ```
- Add an `onError`:
  ```tsx
  onError: (err) => toast.error('Power action failed', err instanceof Error ? err.message : String(err)),
  ```
- Delete the entire `{toast && (<div ...>{toast}</div>)}` block from JSX
- Remove the `const [toast, setToast] = useState('');` line

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/dashboard/system/power/page.tsx && git commit -m "refactor(power): use global toast instead of inline banner"
```

---

## Task 4: Packages Page Toasts

**Files:**
- Modify: `nexus/src/app/dashboard/system/packages/page.tsx`

- [ ] **Step 1: Add onSuccess + onError toasts to mutations**

Read the file first. Then:

Add this import near the top:
```tsx
import { useToast } from '@/components/ui/toast';
```

Inside `PackagesPage()` add `const toast = useToast();` after the existing hook declarations.

Update the `refreshM` useMutation block to:

```tsx
const refreshM = useMutation({
  mutationFn: () => api.apt.update(node),
  onSuccess: (upid) => {
    setTaskUpid(upid);
    toast.success('Refreshing apt cache', `Task ${upid.slice(0, 24)}…`);
    setTimeout(() => {
      refetchPve();
      refetchSys();
    }, 3000);
  },
  onError: (err) => toast.error('Refresh failed', err instanceof Error ? err.message : String(err)),
});
```

Update the `installM` useMutation block to:

```tsx
const installM = useMutation({
  mutationFn: (packages: string[]) => api.apt.install(node, packages),
  onSuccess: (upid, variables) => {
    setTaskUpid(upid);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ['apt'] });
    const what = variables.length > 0 ? `${variables.length} package${variables.length !== 1 ? 's' : ''}` : 'full upgrade';
    toast.success(`Upgrade queued: ${what}`, `Watch Tasks page for progress`);
  },
  onError: (err) => toast.error('Upgrade failed', err instanceof Error ? err.message : String(err)),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/dashboard/system/packages/page.tsx && git commit -m "feat(packages): surface refresh/install outcomes via toast"
```

---

## Task 5: Certificates & Tunnels Toasts

**Files:**
- Modify: `nexus/src/app/dashboard/system/certificates/page.tsx`

- [ ] **Step 1: Wire toast into all mutations**

Read the file first. Add import:
```tsx
import { useToast } from '@/components/ui/toast';
```

Inside `TunnelCard`, add `const toast = useToast();` near the top (alongside `useQueryClient`), and update `execM`:

```tsx
const execM = useMutation({
  mutationFn: (cmd: string) => api.exec.shellCmd(node, cmd),
  onSuccess: (result) => {
    const output = typeof result === 'string' ? result : JSON.stringify(result);
    setOutput(output);
    qc.invalidateQueries({ queryKey: ['tunnel', node, provider.id] });
    toast.success(`${provider.name} command sent`, output.slice(0, 160));
  },
  onError: (err) => toast.error(`${provider.name} command failed`, err instanceof Error ? err.message : String(err)),
});
```

Inside `CertificatesPage`, add `const toast = useToast();` after the existing hooks. Update each of the four mutations:

```tsx
const uploadM = useMutation({
  mutationFn: () => api.certificates.uploadCustom(node, certPem, keyPem),
  onSuccess: () => {
    setCertPem('');
    setKeyPem('');
    qc.invalidateQueries({ queryKey: ['certificates', node] });
    toast.success('Certificate uploaded', `Restart pveproxy for it to take effect.`);
  },
  onError: (err) => toast.error('Upload failed', err instanceof Error ? err.message : String(err)),
});

const deleteCustomM = useMutation({
  mutationFn: () => api.certificates.deleteCustom(node),
  onSuccess: () => {
    setShowDeleteConfirm(false);
    qc.invalidateQueries({ queryKey: ['certificates', node] });
    toast.success('Custom certificate deleted', 'Reverted to self-signed.');
  },
  onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
});

const registerAccountM = useMutation({
  mutationFn: () => api.acme.registerAccount('default', acmeEmail),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['acme', 'accounts'] });
    toast.success('ACME account registered', acmeEmail);
  },
  onError: (err) => toast.error('Registration failed', err instanceof Error ? err.message : String(err)),
});

const orderCertM = useMutation({
  mutationFn: () => api.certificates.orderAcme(node),
  onSuccess: (upid) => {
    setTaskUpid(upid);
    toast.success('Certificate order queued', upid.slice(0, 48));
  },
  onError: (err) => toast.error('Order failed', err instanceof Error ? err.message : String(err)),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/dashboard/system/certificates/page.tsx && git commit -m "feat(certificates): surface cert/acme/tunnel outcomes via toast"
```

---

## Task 6: Scripts Page Persistent Error Toast

**Files:**
- Modify: `nexus/src/app/scripts/page.tsx`

- [ ] **Step 1: Add error toast**

Read the file first. Add import:
```tsx
import { useToast } from '@/components/ui/toast';
```

Inside the component, add `const toast = useToast();` near other hooks.

Find the script execution failure path (where `runState` is set with an error). After the existing `setRunState(...)` error branch, add:

```tsx
toast.error('Script execution failed', errorMessage);
```

where `errorMessage` is whichever variable currently holds the error text. If the existing code uses `err.message`, pass that same variable into `toast.error`.

Also add a success toast where `runState` is set on successful completion:

```tsx
toast.success('Script completed', `${script.name} finished`);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/scripts/page.tsx && git commit -m "feat(scripts): persistent toast on script success/failure"
```

---

## Task 7: Console Page Reads Query Params

**Files:**
- Modify: `nexus/src/app/console/page.tsx`

- [ ] **Step 1: Auto-open tab from URL**

Open `nexus/src/app/console/page.tsx`. Add these imports at top:

```tsx
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
```

Inside `ConsolePage()`, after the existing `useState` declarations, add:

```tsx
const searchParams = useSearchParams();

useEffect(() => {
  const node = searchParams.get('node');
  const vmidStr = searchParams.get('vmid');
  const type = searchParams.get('type') as 'qemu' | 'lxc' | 'node' | null;
  if (!node || !type) return;
  const vmid = vmidStr ? parseInt(vmidStr, 10) : undefined;
  const id = type === 'node' ? `node/${node}` : `${type}/${node}/${vmid}`;
  if (tabs.find((t) => t.id === id)) {
    setActiveTab(id);
    return;
  }
  setTabs((prev) => [
    ...prev,
    { id, label: vmid ? `${type.toUpperCase()} ${vmid}` : node, node, vmid, type },
  ]);
  setActiveTab(id);
  // Run once per param change
}, [searchParams, tabs]);
```

Also update the "Console" button in the command palette (line ~192) from `onClick={() => navigate('/console')}` to pass query params. In `command-palette.tsx` update the VM console button's onClick to:

```tsx
onClick={() => navigate(`/console?node=${encodeURIComponent(vm.node!)}&vmid=${vm.vmid}&type=qemu`)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/console/page.tsx src/components/dashboard/command-palette.tsx && git commit -m "fix(console): honour node/vmid/type query params from VM/CT links"
```

---

## Task 8: Network Apply/Revert Safety

**Files:**
- Modify: `nexus/src/app/dashboard/system/network/page.tsx`

- [ ] **Step 1: Add confirm + toasts around apply/revert**

Read the file first. Add import:
```tsx
import { useToast } from '@/components/ui/toast';
```

Inside `NetworkPage()` add:
```tsx
const toast = useToast();
const [showApplyConfirm, setShowApplyConfirm] = useState(false);
const [showRevertConfirm, setShowRevertConfirm] = useState(false);
```

Update the `applyM` and `revertM` mutations to include toasts:

```tsx
const applyM = useMutation({
  mutationFn: () => api.networkIfaces.apply(node),
  onSuccess: () => {
    setHasPending(false);
    setShowApplyConfirm(false);
    qc.invalidateQueries({ queryKey: ['network', node] });
    toast.success('Network configuration applied', 'Changes are now live on the node.');
  },
  onError: (err) => toast.error('Apply failed', err instanceof Error ? err.message : String(err)),
});

const revertM = useMutation({
  mutationFn: () => api.networkIfaces.revert(node),
  onSuccess: () => {
    setHasPending(false);
    setShowRevertConfirm(false);
    qc.invalidateQueries({ queryKey: ['network', node] });
    toast.info('Pending network changes reverted');
  },
  onError: (err) => toast.error('Revert failed', err instanceof Error ? err.message : String(err)),
});
```

Change both the "Apply Configuration" and "Revert" button `onClick` handlers to open ConfirmDialog instead of calling `.mutate()` directly:

```tsx
onClick={() => setShowApplyConfirm(true)}
```

```tsx
onClick={() => setShowRevertConfirm(true)}
```

Just inside the `<>` fragment return (next to the existing `showDeleteConfirm` dialog), add:

```tsx
{showApplyConfirm && (
  <ConfirmDialog
    title="Apply network configuration?"
    message={`Applying changes on node "${node}" runs ifreload — if the new config is wrong the node may become unreachable. Continue?`}
    danger
    onConfirm={() => applyM.mutate()}
    onCancel={() => setShowApplyConfirm(false)}
  />
)}
{showRevertConfirm && (
  <ConfirmDialog
    title="Revert pending network changes?"
    message="All uncommitted interface edits will be discarded."
    onConfirm={() => revertM.mutate()}
    onCancel={() => setShowRevertConfirm(false)}
  />
)}
```

Also add toasts to the existing `createM`, `updateM`, and `deleteM` mutations. Update each's `onSuccess` to include a toast call and add `onError`:

```tsx
const createM = useMutation({
  mutationFn: (params: NetworkIfaceParams) => api.networkIfaces.create(node, params),
  onSuccess: () => {
    setShowCreate(false);
    markPending();
    qc.invalidateQueries({ queryKey: ['network', node] });
    toast.success('Interface created', 'Apply changes to activate.');
  },
  onError: (err) => toast.error('Create failed', err instanceof Error ? err.message : String(err)),
});

const updateM = useMutation({
  mutationFn: (params: Partial<NetworkIfaceParams>) =>
    api.networkIfaces.update(node, selectedIface!, params),
  onSuccess: () => {
    setEditing(false);
    markPending();
    qc.invalidateQueries({ queryKey: ['network', node] });
    toast.success('Interface updated', 'Apply changes to activate.');
  },
  onError: (err) => toast.error('Update failed', err instanceof Error ? err.message : String(err)),
});

const deleteM = useMutation({
  mutationFn: () => api.networkIfaces.delete(node, selectedIface!),
  onSuccess: () => {
    setSelectedIface(null);
    setShowDeleteConfirm(false);
    markPending();
    qc.invalidateQueries({ queryKey: ['network', node] });
    toast.success('Interface removed', 'Apply changes to activate.');
  },
  onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/dashboard/system/network/page.tsx && git commit -m "feat(network): confirm destructive apply/revert and toast all mutations"
```

---

## Task 9: Tasks Page Pause/Resume

**Files:**
- Modify: `nexus/src/app/dashboard/tasks/page.tsx`

- [ ] **Step 1: Add pause toggle**

Read the file first. Add `Pause` and `Play` to the existing lucide import:
```tsx
import { Pause, Play } from 'lucide-react';
```

Inside `TasksPage()`, add:
```tsx
const [paused, setPaused] = useState(false);
```

Change `refetchInterval: 10_000,` in the `useQuery` call to:
```tsx
refetchInterval: paused ? false : 10_000,
```

Next to the existing Refresh button in the header, add:
```tsx
<button
  onClick={() => setPaused((p) => !p)}
  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-400 transition"
>
  {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
  {paused ? 'Resume' : 'Pause'}
</button>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/dashboard/tasks/page.tsx && git commit -m "feat(tasks): add pause/resume toggle for auto-refresh"
```

---

## Task 10: Graphical Console (noVNC) Redirect

**Files:**
- Create: `nexus/src/app/console/vnc/page.tsx`
- Modify: `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx`
- Modify: `nexus/src/app/dashboard/cts/[node]/[vmid]/page.tsx`

**Approach:** A minimal but functional entry point — clicking "Graphical Console" on a VM/CT opens a new tab to `/console/vnc?node=X&vmid=Y&type=qemu`. That route renders a short interstitial that reads the target host from session and redirects to PVE's native vnc.html URL (`https://<host>:8006/?console=kvm&vmid=X&node=Y&novnc=1`). The user needs to be logged into PVE directly in the same browser; if not, they'll be prompted by PVE's login page. This matches the Proxmox brief's "embed Proxmox vnc.html" option at minimum effort, without adding the @novnc/novnc dependency.

- [ ] **Step 1: Create the VNC redirect page**

Create `nexus/src/app/console/vnc/page.tsx`:

```tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, ExternalLink, AlertCircle } from 'lucide-react';

interface Session {
  proxmoxHost: string;
}

export default function VncConsolePage() {
  const params = useSearchParams();
  const [err, setErr] = useState('');
  const [url, setUrl] = useState('');

  const node = params.get('node');
  const vmid = params.get('vmid');
  const type = params.get('type');

  useEffect(() => {
    if (!node || !vmid || !type) {
      setErr('Missing node, vmid, or type query params.');
      return;
    }
    fetch('/api/auth/session', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Not authenticated');
        return r.json();
      })
      .then((s: Session) => {
        const host = s.proxmoxHost;
        const consoleType = type === 'qemu' ? 'kvm' : 'lxc';
        const target = `https://${host}:8006/?console=${consoleType}&vmid=${vmid}&node=${node}&novnc=1`;
        setUrl(target);
        // Redirect the current window — opened via target="_blank" so we don't lose state.
        window.location.replace(target);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [node, vmid, type]);

  return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-300">
      <div className="max-w-md px-6 py-8 bg-gray-900 border border-gray-800 rounded-2xl text-center space-y-4">
        {err ? (
          <>
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <h1 className="text-lg font-semibold text-white">Cannot open graphical console</h1>
            <p className="text-sm text-gray-400">{err}</p>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 text-orange-500 animate-spin mx-auto" />
            <h1 className="text-lg font-semibold text-white">Opening graphical console…</h1>
            <p className="text-sm text-gray-500">
              Redirecting to Proxmox native noVNC client. You may be asked to log in to PVE directly if this is the first time.
            </p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
              >
                <ExternalLink className="w-4 h-4" />
                Open manually
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add "Graphical Console" button to VM detail page**

Open `nexus/src/app/dashboard/vms/[node]/[vmid]/page.tsx`. Add `Monitor` is probably already imported; also ensure `Terminal` and `ExternalLink` are available — if `ExternalLink` isn't imported, add it to the lucide-react import.

Find the header action bar that contains the existing action buttons (start/stop/reboot etc.) — on VM pages this is the section around the status badge. Next to the "Console" button (or near the top-right action row), add:

```tsx
<a
  href={`/console/vnc?node=${encodeURIComponent(node)}&vmid=${vmid}&type=qemu`}
  target="_blank"
  rel="noreferrer"
  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition"
  title="Open graphical console in a new tab"
>
  <ExternalLink className="w-3.5 h-3.5" />
  Graphical Console
</a>
```

If the file already has a Console button wired to `/console?node=...`, leave it alone and add this new button next to it. If there isn't one yet, just add this one.

- [ ] **Step 3: Same for CT detail page**

Open `nexus/src/app/dashboard/cts/[node]/[vmid]/page.tsx`. Add the same button but with `type=lxc`:

```tsx
<a
  href={`/console/vnc?node=${encodeURIComponent(node)}&vmid=${vmid}&type=lxc`}
  target="_blank"
  rel="noreferrer"
  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition"
  title="Open graphical console in a new tab"
>
  <ExternalLink className="w-3.5 h-3.5" />
  Graphical Console
</a>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git add src/app/console/vnc/page.tsx src/app/dashboard/vms/'[node]'/'[vmid]'/page.tsx src/app/dashboard/cts/'[node]'/'[vmid]'/page.tsx && git commit -m "feat(console): add graphical (noVNC) console entry point"
```

---

## Task 11: Final Build Verification

- [ ] **Step 1: Full production build**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && npm run build 2>&1 | tail -30
```

Expected: "✓ Compiled successfully", no TypeScript errors.

- [ ] **Step 2: If the build introduced any fixes, commit**

```bash
cd /Users/devlin/Documents/GitHub/Proxmox/nexus && git status
```

If clean, nothing to commit. Otherwise commit whatever adjustments were needed.

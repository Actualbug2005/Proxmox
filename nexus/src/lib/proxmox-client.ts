/**
 * Proxmox API Client
 * Thin fetch wrapper that routes through the local Next.js proxy (/api/proxmox/...)
 * All auth state is carried via httpOnly cookie — this client is safe to use
 * from both client and server components.
 */

export class ProxmoxAPIError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProxmoxAPIError';
  }
}

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions {
  method?: HTTPMethod;
  body?: Record<string, unknown>;
  /** Node-side fetch (server components): include credentials manually */
  serverSide?: boolean;
  /** Raw URLSearchParams for POST bodies that PVE expects as form-encoded */
  formBody?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formBody } = opts;

  // Strip leading slash; proxy route adds it back
  const cleanPath = path.replace(/^\//, '');
  const url = `/api/proxmox/${cleanPath}`;

  const headers: Record<string, string> = {};
  let fetchBody: BodyInit | undefined;

  if (formBody) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchBody = new URLSearchParams(formBody).toString();
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: fetchBody,
    credentials: 'include',
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const err = await res.json();
      message = err?.errors
        ? Object.values(err.errors as Record<string, string>).join('; ')
        : err?.message ?? message;
    } catch {
      // ignore parse errors
    }
    throw new ProxmoxAPIError(res.status, res.statusText, message);
  }

  const json = await res.json();
  // PVE wraps everything in { data: ... }
  return ('data' in json ? json.data : json) as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const proxmox = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),

  post: <T>(path: string, body?: Record<string, unknown>) =>
    request<T>(path, { method: 'POST', body }),

  postForm: <T>(path: string, formBody: Record<string, string>) =>
    request<T>(path, { method: 'POST', formBody }),

  put: <T>(path: string, body?: Record<string, unknown>) =>
    request<T>(path, { method: 'PUT', body }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ─── Typed helpers ────────────────────────────────────────────────────────────

import type {
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
} from '@/types/proxmox';

export const api = {
  // VMs (QEMU)
  vms: {
    list: (node: string) => proxmox.get<PVEVM[]>(`nodes/${node}/qemu`),
    status: (node: string, vmid: number) =>
      proxmox.get<PVEVM>(`nodes/${node}/qemu/${vmid}/status/current`),
    config: (node: string, vmid: number) =>
      proxmox.get<VMConfigFull>(`nodes/${node}/qemu/${vmid}/config`),
    updateConfig: (node: string, vmid: number, params: UpdateVMConfigParams) =>
      proxmox.put<null>(`nodes/${node}/qemu/${vmid}/config`, params as Record<string, unknown>),
    start: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/status/start`),
    stop: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/status/stop`),
    shutdown: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/status/shutdown`),
    reboot: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/status/reboot`),
    suspend: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/status/suspend`),
    resume: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/status/resume`),
    delete: (node: string, vmid: number, purge = true) =>
      proxmox.delete<string>(`nodes/${node}/qemu/${vmid}${purge ? '?purge=1&destroy-unreferenced-disks=1' : ''}`),
    clone: (node: string, vmid: number, params: CloneVMParams) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/clone`, params as Record<string, unknown>),
    migrate: (node: string, vmid: number, params: MigrateVMParams) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/migrate`, params as Record<string, unknown>),
    create: (node: string, params: Omit<CreateVMParams, 'node'>) =>
      proxmox.post<string>(`nodes/${node}/qemu`, params as Record<string, unknown>),
    vncproxy: (node: string, vmid: number) =>
      proxmox.post<VNCProxyResponse>(`nodes/${node}/qemu/${vmid}/vncproxy`, { websocket: 1 }),
    rrd: (node: string, vmid: number, timeframe: 'hour' | 'day' | 'week' = 'hour') =>
      proxmox.get<NodeRRDData[]>(`nodes/${node}/qemu/${vmid}/rrddata?timeframe=${timeframe}&cf=AVERAGE`),
  },

  // LXC Containers
  containers: {
    list: (node: string) => proxmox.get<PVECT[]>(`nodes/${node}/lxc`),
    status: (node: string, vmid: number) =>
      proxmox.get<PVECT>(`nodes/${node}/lxc/${vmid}/status/current`),
    config: (node: string, vmid: number) =>
      proxmox.get<CTConfig>(`nodes/${node}/lxc/${vmid}/config`),
    updateConfig: (node: string, vmid: number, params: UpdateCTConfigParams) =>
      proxmox.put<null>(`nodes/${node}/lxc/${vmid}/config`, params as Record<string, unknown>),
    start: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/status/start`),
    stop: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/status/stop`),
    shutdown: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/status/shutdown`),
    reboot: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/status/reboot`),
    suspend: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/status/suspend`),
    resume: (node: string, vmid: number) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/status/resume`),
    delete: (node: string, vmid: number, purge = true) =>
      proxmox.delete<string>(`nodes/${node}/lxc/${vmid}${purge ? '?purge=1&destroy-unreferenced-disks=1' : ''}`),
    clone: (node: string, vmid: number, params: CloneCTParams) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/clone`, params as Record<string, unknown>),
    migrate: (node: string, vmid: number, params: MigrateCTParams) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/migrate`, params as Record<string, unknown>),
    create: (node: string, params: Omit<CreateCTParams, 'node'>) =>
      proxmox.post<string>(`nodes/${node}/lxc`, params as Record<string, unknown>),
    vncproxy: (node: string, vmid: number) =>
      proxmox.post<VNCProxyResponse>(`nodes/${node}/lxc/${vmid}/vncproxy`, { websocket: 1 }),
    rrd: (node: string, vmid: number, timeframe: 'hour' | 'day' | 'week' = 'hour') =>
      proxmox.get<NodeRRDData[]>(`nodes/${node}/lxc/${vmid}/rrddata?timeframe=${timeframe}&cf=AVERAGE`),
  },

  // Storage
  storage: {
    list: (node: string) => proxmox.get<PVEStorage[]>(`nodes/${node}/storage`),
    listWithContent: (node: string, content: string) =>
      proxmox.get<PVEStorage[]>(`nodes/${node}/storage?content=${content}`),
    content: (node: string, storage: string, content?: string) =>
      proxmox.get<StorageContent[]>(
        `nodes/${node}/storage/${storage}/content${content ? `?content=${content}` : ''}`,
      ),
  },

  // Network
  network: {
    list: (node: string, type?: string) =>
      proxmox.get<NodeNetwork[]>(`nodes/${node}/network${type ? `?type=${type}` : ''}`),
  },

  // Cluster
  cluster: {
    resources: () => proxmox.get<ClusterResource[]>('cluster/resources'),
    tasks: () => proxmox.get<PVETask[]>('cluster/tasks'),
    nextid: () => proxmox.get<number>('cluster/nextid'),
  },

  // Tasks
  tasks: {
    status: (node: string, upid: string) =>
      proxmox.get<PVETask>(`nodes/${node}/tasks/${encodeURIComponent(upid)}/status`),
    log: (node: string, upid: string) =>
      proxmox.get<{ n: number; t: string }[]>(
        `nodes/${node}/tasks/${encodeURIComponent(upid)}/log`,
      ),
  },

  // Nodes
  nodes: {
    list: () => proxmox.get<PVENode[]>('nodes'),
    status: (node: string) => proxmox.get<NodeStatus>(`nodes/${node}/status`),
    rrd: (node: string, timeframe: 'hour' | 'day' | 'week' = 'hour') =>
      proxmox.get<NodeRRDData[]>(`nodes/${node}/rrddata?timeframe=${timeframe}&cf=AVERAGE`),
    tasks: (node: string) => proxmox.get<PVETask[]>(`nodes/${node}/tasks`),
  },

  // Node exec (for community scripts)
  exec: {
    shellCmd: (node: string, commands: string) =>
      proxmox.post<string>(`nodes/${node}/execute`, { commands }),
  },
};

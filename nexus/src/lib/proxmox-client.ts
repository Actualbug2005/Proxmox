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
    // 401 from the proxy means either no session or an expired PVE ticket.
    // The proxy has already cleared the cookie — send the user to login.
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
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
  NodePowerCommand,
  AptInstalledPackage,
  AptUpdatablePackage,
  NetworkIface,
  NetworkIfaceParams,
  CertificateInfo,
  AcmeAccount,
  JournalEntry,
  JournalParams,
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

  // Local shell executor — hits our own /api/exec, which runs on the PVE host
  // that's hosting Nexus. PVE's /nodes/{node}/execute is an API-batch endpoint,
  // not a shell runner, so we bypass it entirely for shell work.
  exec: {
    shellCmd: async (node: string, command: string) => {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, node }),
        credentials: 'include',
      });
      const data = (await res.json()) as {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new ProxmoxAPIError(res.status, res.statusText, data.error ?? res.statusText);
      }
      if (data.exitCode !== 0) {
        throw new ProxmoxAPIError(200, 'Command failed', data.stderr || data.error || `exit ${data.exitCode}`);
      }
      return (data.stdout ?? '').trim();
    },
  },

  apt: {
    versions: (node: string) =>
      proxmox.get<AptInstalledPackage[]>(`nodes/${node}/apt/versions`),
    update: (node: string) =>
      proxmox.post<string>(`nodes/${node}/apt/update`),
    upgradable: (node: string) =>
      proxmox.get<AptUpdatablePackage[]>(`nodes/${node}/apt/update`),
    install: (node: string, packages: string[]) =>
      api.exec.shellCmd(
        node,
        packages.length > 0
          ? `DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages.join(' ')}`
          : `DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y`,
      ),
  },

  // Note: named networkIfaces (not network) to avoid shadowing the existing api.network.list method
  networkIfaces: {
    list: (node: string) =>
      proxmox.get<NetworkIface[]>(`nodes/${node}/network`),
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
};

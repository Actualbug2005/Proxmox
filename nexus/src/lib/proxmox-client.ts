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

const MUTATING = new Set<HTTPMethod>(['POST', 'PUT', 'DELETE']);

/** Read the non-httpOnly nexus_csrf cookie set at login. Empty string in
 *  non-browser contexts — mutating requests from the server happen inside
 *  the Node process with direct session access, so they don't need CSRF. */
export function readCsrfCookie(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)nexus_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

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

  if (MUTATING.has(method)) {
    const csrf = readCsrfCookie();
    if (csrf) headers['X-Nexus-CSRF'] = csrf;
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
  PVESnapshot,
  CreateSnapshotParams,
  BackupJob,
  BackupJobParams,
  BackupFile,
  VzdumpParams,
  RestoreParams,
  IsoUploadParams,
  DownloadUrlParams,
  StorageContentType,
  FirewallRule,
  FirewallRuleParams,
  FirewallAlias,
  FirewallIPSet,
  FirewallIPSetEntry,
  FirewallGroup,
  FirewallOptions,
  PVEUser,
  UserParams,
  PVEGroup,
  GroupParams,
  PVERole,
  RoleParams,
  PVERealm,
  RealmParams,
  PVEACL,
  ACLParams,
  HAResource,
  HAResourceParams,
  HAGroup,
  HAGroupParams,
  HAStatus,
  ClusterStatus,
  PVEPool,
  PoolParams,
  DiskListEntry,
  SmartData,
} from '@/types/proxmox';
import type {
  NasShare,
  NasService,
  CreateNasSharePayload,
} from '@/types/nas';

/**
 * Sibling to `request<T>` for endpoints that DON'T route through the PVE
 * proxy — /api/nas/*, /api/tunnels/*, etc. Attaches the same CSRF header
 * on mutating verbs and the credentials cookie on every call.
 */
async function nasRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...((init.headers as Record<string, string> | undefined) ?? {}) };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method as HTTPMethod)) {
    const csrf = readCsrfCookie();
    if (csrf) headers['X-Nexus-CSRF'] = csrf;
  }

  const res = await fetch(path, { ...init, method, headers, credentials: 'include' });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const err = await res.json();
      message = err?.error ?? err?.message ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ProxmoxAPIError(res.status, res.statusText, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

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
    snapshot: {
      list: (node: string, vmid: number) =>
        proxmox.get<PVESnapshot[]>(`nodes/${node}/qemu/${vmid}/snapshot`),
      create: (node: string, vmid: number, params: CreateSnapshotParams) =>
        proxmox.post<string>(`nodes/${node}/qemu/${vmid}/snapshot`, params as Record<string, unknown>),
      delete: (node: string, vmid: number, snapname: string, force = false) =>
        proxmox.delete<string>(`nodes/${node}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}${force ? '?force=1' : ''}`),
      rollback: (node: string, vmid: number, snapname: string) =>
        proxmox.post<string>(`nodes/${node}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}/rollback`),
      getConfig: (node: string, vmid: number, snapname: string) =>
        proxmox.get<Record<string, unknown>>(`nodes/${node}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}/config`),
      updateDescription: (node: string, vmid: number, snapname: string, description: string) =>
        proxmox.put<null>(`nodes/${node}/qemu/${vmid}/snapshot/${encodeURIComponent(snapname)}/config`, { description }),
    },
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
    snapshot: {
      list: (node: string, vmid: number) =>
        proxmox.get<PVESnapshot[]>(`nodes/${node}/lxc/${vmid}/snapshot`),
      create: (node: string, vmid: number, params: CreateSnapshotParams) =>
        proxmox.post<string>(`nodes/${node}/lxc/${vmid}/snapshot`, params as Record<string, unknown>),
      delete: (node: string, vmid: number, snapname: string, force = false) =>
        proxmox.delete<string>(`nodes/${node}/lxc/${vmid}/snapshot/${encodeURIComponent(snapname)}${force ? '?force=1' : ''}`),
      rollback: (node: string, vmid: number, snapname: string) =>
        proxmox.post<string>(`nodes/${node}/lxc/${vmid}/snapshot/${encodeURIComponent(snapname)}/rollback`),
      getConfig: (node: string, vmid: number, snapname: string) =>
        proxmox.get<Record<string, unknown>>(`nodes/${node}/lxc/${vmid}/snapshot/${encodeURIComponent(snapname)}/config`),
      updateDescription: (node: string, vmid: number, snapname: string, description: string) =>
        proxmox.put<null>(`nodes/${node}/lxc/${vmid}/snapshot/${encodeURIComponent(snapname)}/config`, { description }),
    },
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
    contentByType: (node: string, storage: string, content: StorageContentType) =>
      proxmox.get<StorageContent[]>(
        `nodes/${node}/storage/${encodeURIComponent(storage)}/content?content=${content}`,
      ),
    deleteContent: (node: string, storage: string, volid: string) =>
      proxmox.delete<null>(`nodes/${node}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`),
    /** Upload via dedicated /api/iso-upload route (bypasses the JSON proxy).
     *  Uses XMLHttpRequest under the hood so callers can receive upload progress events.
     *  Returns the PVE task UPID on success. */
    upload: (params: IsoUploadParams, onProgress?: (pct: number) => void): Promise<string> =>
      new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('node', params.node);
        form.append('storage', params.storage);
        form.append('content', params.content);
        form.append('filename', params.filename);
        form.append('file', params.file, params.filename);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/iso-upload');
        xhr.withCredentials = true;
        const csrf = readCsrfCookie();
        if (csrf) xhr.setRequestHeader('X-Nexus-CSRF', csrf);

        if (onProgress) {
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          });
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const body = JSON.parse(xhr.responseText);
              resolve(typeof body.data === 'string' ? body.data : xhr.responseText);
            } catch {
              resolve(xhr.responseText);
            }
          } else {
            let msg = xhr.statusText;
            try {
              const err = JSON.parse(xhr.responseText);
              msg = err.error ?? err.message ?? msg;
            } catch {
              /* ignore */
            }
            reject(new ProxmoxAPIError(xhr.status, xhr.statusText, msg));
          }
        };

        xhr.onerror = () => reject(new ProxmoxAPIError(0, 'Network error', 'Upload failed'));
        xhr.send(form);
      }),
    downloadUrl: (params: DownloadUrlParams) =>
      proxmox.post<string>(
        `nodes/${params.node}/storage/${encodeURIComponent(params.storage)}/download-url`,
        { ...params } as Record<string, unknown>,
      ),
  },

  // Network
  network: {
    list: (node: string, type?: string) =>
      proxmox.get<NodeNetwork[]>(`nodes/${node}/network${type ? `?type=${type}` : ''}`),
  },

  // Physical disks (S.M.A.R.T.)
  disks: {
    list: (node: string) => proxmox.get<DiskListEntry[]>(`nodes/${node}/disks/list`),
    smart: (node: string, disk: string) =>
      proxmox.get<SmartData>(`nodes/${node}/disks/smart?disk=${encodeURIComponent(disk)}`),
  },

  // NAS shares & services (provider-pattern; hits /api/nas/* directly)
  nas: {
    getShares: (node: string): Promise<NasShare[]> =>
      nasRequest<{ shares: NasShare[] }>(
        `/api/nas/shares?node=${encodeURIComponent(node)}`,
      ).then((r) => r.shares),

    createShare: (node: string, payload: CreateNasSharePayload): Promise<NasShare> =>
      nasRequest<{ share: NasShare }>('/api/nas/shares', {
        method: 'POST',
        body: JSON.stringify({ node, ...payload }),
      }).then((r) => r.share),

    deleteShare: (node: string, id: string): Promise<void> =>
      nasRequest<void>(
        `/api/nas/shares?node=${encodeURIComponent(node)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),

    getServices: (node: string): Promise<NasService[]> =>
      nasRequest<{ services: NasService[] }>(
        `/api/nas/services?node=${encodeURIComponent(node)}`,
      ).then((r) => r.services),
  },

  // Cluster
  cluster: {
    resources: () => proxmox.get<ClusterResource[]>('cluster/resources'),
    tasks: () => proxmox.get<PVETask[]>('cluster/tasks'),
    nextid: () => proxmox.get<number>('cluster/nextid'),
    status: () => proxmox.get<ClusterStatus[]>('cluster/status'),
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
      const csrf = readCsrfCookie();
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
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

  backups: {
    jobs: {
      list: () => proxmox.get<BackupJob[]>('cluster/backup'),
      get: (id: string) => proxmox.get<BackupJob>(`cluster/backup/${encodeURIComponent(id)}`),
      create: (params: BackupJobParams) =>
        proxmox.post<null>('cluster/backup', params as Record<string, unknown>),
      update: (id: string, params: BackupJobParams) =>
        proxmox.put<null>(`cluster/backup/${encodeURIComponent(id)}`, params as Record<string, unknown>),
      delete: (id: string) =>
        proxmox.delete<null>(`cluster/backup/${encodeURIComponent(id)}`),
    },
    vzdump: (node: string, params: VzdumpParams) =>
      proxmox.post<string>(`nodes/${node}/vzdump`, params as Record<string, unknown>),
    files: (node: string, storage: string) =>
      proxmox.get<BackupFile[]>(`nodes/${node}/storage/${encodeURIComponent(storage)}/content?content=backup`),
    delete: (node: string, storage: string, volid: string) =>
      proxmox.delete<null>(`nodes/${node}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`),
    restoreVM: (node: string, params: RestoreParams) =>
      proxmox.post<string>(`nodes/${node}/qemu`, { ...params } as Record<string, unknown>),
    restoreCT: (node: string, params: RestoreParams) =>
      proxmox.post<string>(`nodes/${node}/lxc`, { ...params } as Record<string, unknown>),
    protect: (node: string, storage: string, volid: string, isProtected: boolean) =>
      proxmox.put<null>(
        `nodes/${node}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`,
        { protected: isProtected ? 1 : 0 },
      ),
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

  firewall: {
    cluster: {
      rules: {
        list: () => proxmox.get<FirewallRule[]>('cluster/firewall/rules'),
        get: (pos: number) => proxmox.get<FirewallRule>(`cluster/firewall/rules/${pos}`),
        create: (params: FirewallRuleParams) =>
          proxmox.post<null>('cluster/firewall/rules', params as Record<string, unknown>),
        update: (pos: number, params: FirewallRuleParams) =>
          proxmox.put<null>(`cluster/firewall/rules/${pos}`, params as Record<string, unknown>),
        delete: (pos: number, digest?: string) =>
          proxmox.delete<null>(
            `cluster/firewall/rules/${pos}${digest ? `?digest=${encodeURIComponent(digest)}` : ''}`,
          ),
        move: (pos: number, moveto: number, digest?: string) =>
          proxmox.put<null>(
            `cluster/firewall/rules/${pos}`,
            { moveto, ...(digest ? { digest } : {}) } as Record<string, unknown>,
          ),
      },
      aliases: {
        list: () => proxmox.get<FirewallAlias[]>('cluster/firewall/aliases'),
        get: (name: string) => proxmox.get<FirewallAlias>(`cluster/firewall/aliases/${encodeURIComponent(name)}`),
        create: (alias: FirewallAlias) =>
          proxmox.post<null>('cluster/firewall/aliases', alias as unknown as Record<string, unknown>),
        update: (name: string, alias: Partial<FirewallAlias>) =>
          proxmox.put<null>(`cluster/firewall/aliases/${encodeURIComponent(name)}`, alias as Record<string, unknown>),
        delete: (name: string) =>
          proxmox.delete<null>(`cluster/firewall/aliases/${encodeURIComponent(name)}`),
      },
      ipsets: {
        list: () => proxmox.get<FirewallIPSet[]>('cluster/firewall/ipset'),
        create: (ipset: FirewallIPSet) =>
          proxmox.post<null>('cluster/firewall/ipset', ipset as unknown as Record<string, unknown>),
        delete: (name: string) =>
          proxmox.delete<null>(`cluster/firewall/ipset/${encodeURIComponent(name)}`),
        entries: (name: string) =>
          proxmox.get<FirewallIPSetEntry[]>(`cluster/firewall/ipset/${encodeURIComponent(name)}`),
        addEntry: (name: string, entry: FirewallIPSetEntry) =>
          proxmox.post<null>(`cluster/firewall/ipset/${encodeURIComponent(name)}`, entry as unknown as Record<string, unknown>),
        deleteEntry: (name: string, cidr: string) =>
          proxmox.delete<null>(`cluster/firewall/ipset/${encodeURIComponent(name)}/${encodeURIComponent(cidr)}`),
      },
      groups: {
        list: () => proxmox.get<FirewallGroup[]>('cluster/firewall/groups'),
        create: (group: FirewallGroup) =>
          proxmox.post<null>('cluster/firewall/groups', group as unknown as Record<string, unknown>),
        delete: (name: string) =>
          proxmox.delete<null>(`cluster/firewall/groups/${encodeURIComponent(name)}`),
        rules: (name: string) =>
          proxmox.get<FirewallRule[]>(`cluster/firewall/groups/${encodeURIComponent(name)}`),
        addRule: (name: string, params: FirewallRuleParams) =>
          proxmox.post<null>(
            `cluster/firewall/groups/${encodeURIComponent(name)}`,
            params as Record<string, unknown>,
          ),
      },
      options: {
        get: () => proxmox.get<FirewallOptions>('cluster/firewall/options'),
        update: (opts: Partial<FirewallOptions>) =>
          proxmox.put<null>('cluster/firewall/options', opts as Record<string, unknown>),
      },
    },
    node: {
      rules: {
        list: (node: string) => proxmox.get<FirewallRule[]>(`nodes/${node}/firewall/rules`),
        create: (node: string, params: FirewallRuleParams) =>
          proxmox.post<null>(`nodes/${node}/firewall/rules`, params as Record<string, unknown>),
        update: (node: string, pos: number, params: FirewallRuleParams) =>
          proxmox.put<null>(`nodes/${node}/firewall/rules/${pos}`, params as Record<string, unknown>),
        delete: (node: string, pos: number, digest?: string) =>
          proxmox.delete<null>(
            `nodes/${node}/firewall/rules/${pos}${digest ? `?digest=${encodeURIComponent(digest)}` : ''}`,
          ),
        move: (node: string, pos: number, moveto: number, digest?: string) =>
          proxmox.put<null>(
            `nodes/${node}/firewall/rules/${pos}`,
            { moveto, ...(digest ? { digest } : {}) } as Record<string, unknown>,
          ),
      },
      options: {
        get: (node: string) => proxmox.get<FirewallOptions>(`nodes/${node}/firewall/options`),
        update: (node: string, opts: Partial<FirewallOptions>) =>
          proxmox.put<null>(`nodes/${node}/firewall/options`, opts as Record<string, unknown>),
      },
    },
    vm: {
      rules: {
        list: (node: string, vmid: number) =>
          proxmox.get<FirewallRule[]>(`nodes/${node}/qemu/${vmid}/firewall/rules`),
        create: (node: string, vmid: number, params: FirewallRuleParams) =>
          proxmox.post<null>(`nodes/${node}/qemu/${vmid}/firewall/rules`, params as Record<string, unknown>),
        update: (node: string, vmid: number, pos: number, params: FirewallRuleParams) =>
          proxmox.put<null>(
            `nodes/${node}/qemu/${vmid}/firewall/rules/${pos}`,
            params as Record<string, unknown>,
          ),
        delete: (node: string, vmid: number, pos: number, digest?: string) =>
          proxmox.delete<null>(
            `nodes/${node}/qemu/${vmid}/firewall/rules/${pos}${digest ? `?digest=${encodeURIComponent(digest)}` : ''}`,
          ),
        move: (node: string, vmid: number, pos: number, moveto: number, digest?: string) =>
          proxmox.put<null>(
            `nodes/${node}/qemu/${vmid}/firewall/rules/${pos}`,
            { moveto, ...(digest ? { digest } : {}) } as Record<string, unknown>,
          ),
      },
      options: {
        get: (node: string, vmid: number) =>
          proxmox.get<FirewallOptions>(`nodes/${node}/qemu/${vmid}/firewall/options`),
        update: (node: string, vmid: number, opts: Partial<FirewallOptions>) =>
          proxmox.put<null>(`nodes/${node}/qemu/${vmid}/firewall/options`, opts as Record<string, unknown>),
      },
      aliases: {
        list: (node: string, vmid: number) =>
          proxmox.get<FirewallAlias[]>(`nodes/${node}/qemu/${vmid}/firewall/aliases`),
      },
      ipsets: {
        list: (node: string, vmid: number) =>
          proxmox.get<FirewallIPSet[]>(`nodes/${node}/qemu/${vmid}/firewall/ipset`),
      },
      refs: (node: string, vmid: number) =>
        proxmox.get<unknown[]>(`nodes/${node}/qemu/${vmid}/firewall/refs`),
    },
    ct: {
      rules: {
        list: (node: string, vmid: number) =>
          proxmox.get<FirewallRule[]>(`nodes/${node}/lxc/${vmid}/firewall/rules`),
        create: (node: string, vmid: number, params: FirewallRuleParams) =>
          proxmox.post<null>(`nodes/${node}/lxc/${vmid}/firewall/rules`, params as Record<string, unknown>),
        update: (node: string, vmid: number, pos: number, params: FirewallRuleParams) =>
          proxmox.put<null>(
            `nodes/${node}/lxc/${vmid}/firewall/rules/${pos}`,
            params as Record<string, unknown>,
          ),
        delete: (node: string, vmid: number, pos: number, digest?: string) =>
          proxmox.delete<null>(
            `nodes/${node}/lxc/${vmid}/firewall/rules/${pos}${digest ? `?digest=${encodeURIComponent(digest)}` : ''}`,
          ),
        move: (node: string, vmid: number, pos: number, moveto: number, digest?: string) =>
          proxmox.put<null>(
            `nodes/${node}/lxc/${vmid}/firewall/rules/${pos}`,
            { moveto, ...(digest ? { digest } : {}) } as Record<string, unknown>,
          ),
      },
      options: {
        get: (node: string, vmid: number) =>
          proxmox.get<FirewallOptions>(`nodes/${node}/lxc/${vmid}/firewall/options`),
        update: (node: string, vmid: number, opts: Partial<FirewallOptions>) =>
          proxmox.put<null>(`nodes/${node}/lxc/${vmid}/firewall/options`, opts as Record<string, unknown>),
      },
    },
  },

  access: {
    users: {
      list: () => proxmox.get<PVEUser[]>('access/users'),
      get: (userid: string) => proxmox.get<PVEUser>(`access/users/${encodeURIComponent(userid)}`),
      create: (params: UserParams) =>
        proxmox.post<null>('access/users', params as Record<string, unknown>),
      update: (userid: string, params: Partial<UserParams>) =>
        proxmox.put<null>(`access/users/${encodeURIComponent(userid)}`, params as Record<string, unknown>),
      delete: (userid: string) =>
        proxmox.delete<null>(`access/users/${encodeURIComponent(userid)}`),
      resetPassword: (userid: string, password: string) =>
        proxmox.put<null>('access/password', { userid, password }),
      listTokens: (userid: string) =>
        proxmox.get<unknown[]>(`access/users/${encodeURIComponent(userid)}/token`),
      createToken: (userid: string, tokenid: string, params: Record<string, unknown> = {}) =>
        proxmox.post<{ value: string; info: unknown }>(
          `access/users/${encodeURIComponent(userid)}/token/${encodeURIComponent(tokenid)}`,
          params,
        ),
      deleteToken: (userid: string, tokenid: string) =>
        proxmox.delete<null>(
          `access/users/${encodeURIComponent(userid)}/token/${encodeURIComponent(tokenid)}`,
        ),
    },
    groups: {
      list: () => proxmox.get<PVEGroup[]>('access/groups'),
      get: (groupid: string) => proxmox.get<PVEGroup>(`access/groups/${encodeURIComponent(groupid)}`),
      create: (params: GroupParams) =>
        proxmox.post<null>('access/groups', params as Record<string, unknown>),
      update: (groupid: string, params: Partial<GroupParams>) =>
        proxmox.put<null>(`access/groups/${encodeURIComponent(groupid)}`, params as Record<string, unknown>),
      delete: (groupid: string) =>
        proxmox.delete<null>(`access/groups/${encodeURIComponent(groupid)}`),
    },
    roles: {
      list: () => proxmox.get<PVERole[]>('access/roles'),
      get: (roleid: string) => proxmox.get<PVERole>(`access/roles/${encodeURIComponent(roleid)}`),
      create: (params: RoleParams) =>
        proxmox.post<null>('access/roles', params as Record<string, unknown>),
      update: (roleid: string, params: Partial<RoleParams>) =>
        proxmox.put<null>(`access/roles/${encodeURIComponent(roleid)}`, params as Record<string, unknown>),
      delete: (roleid: string) =>
        proxmox.delete<null>(`access/roles/${encodeURIComponent(roleid)}`),
    },
    realms: {
      list: () => proxmox.get<PVERealm[]>('access/domains'),
      get: (realm: string) => proxmox.get<PVERealm>(`access/domains/${encodeURIComponent(realm)}`),
      create: (params: RealmParams) =>
        proxmox.post<null>('access/domains', params as Record<string, unknown>),
      update: (realm: string, params: Partial<RealmParams>) =>
        proxmox.put<null>(`access/domains/${encodeURIComponent(realm)}`, params as Record<string, unknown>),
      delete: (realm: string) =>
        proxmox.delete<null>(`access/domains/${encodeURIComponent(realm)}`),
      sync: (realm: string) =>
        proxmox.post<string>(`access/domains/${encodeURIComponent(realm)}/sync`),
    },
    acl: {
      list: () => proxmox.get<PVEACL[]>('access/acl'),
      update: (params: ACLParams) =>
        proxmox.put<null>('access/acl', params as Record<string, unknown>),
    },
  },

  ha: {
    status: {
      current: () => proxmox.get<HAStatus[]>('cluster/ha/status/current'),
      managerStatus: () => proxmox.get<Record<string, unknown>>('cluster/ha/status/manager_status'),
    },
    resources: {
      list: () => proxmox.get<HAResource[]>('cluster/ha/resources'),
      get: (sid: string) => proxmox.get<HAResource>(`cluster/ha/resources/${encodeURIComponent(sid)}`),
      create: (params: HAResourceParams) =>
        proxmox.post<null>('cluster/ha/resources', params as Record<string, unknown>),
      update: (sid: string, params: Partial<HAResourceParams>) =>
        proxmox.put<null>(`cluster/ha/resources/${encodeURIComponent(sid)}`, params as Record<string, unknown>),
      delete: (sid: string) =>
        proxmox.delete<null>(`cluster/ha/resources/${encodeURIComponent(sid)}`),
      migrate: (sid: string, target: string) =>
        proxmox.post<null>(`cluster/ha/resources/${encodeURIComponent(sid)}/migrate`, { node: target }),
      relocate: (sid: string, target: string) =>
        proxmox.post<null>(`cluster/ha/resources/${encodeURIComponent(sid)}/relocate`, { node: target }),
    },
    groups: {
      list: () => proxmox.get<HAGroup[]>('cluster/ha/groups'),
      get: (group: string) => proxmox.get<HAGroup>(`cluster/ha/groups/${encodeURIComponent(group)}`),
      create: (params: HAGroupParams) =>
        proxmox.post<null>('cluster/ha/groups', params as Record<string, unknown>),
      update: (group: string, params: Partial<HAGroupParams>) =>
        proxmox.put<null>(`cluster/ha/groups/${encodeURIComponent(group)}`, params as Record<string, unknown>),
      delete: (group: string) =>
        proxmox.delete<null>(`cluster/ha/groups/${encodeURIComponent(group)}`),
    },
  },

  pools: {
    list: () => proxmox.get<PVEPool[]>('pools'),
    get: (poolid: string) => proxmox.get<PVEPool>(`pools/${encodeURIComponent(poolid)}`),
    create: (params: PoolParams) =>
      proxmox.post<null>('pools', params as Record<string, unknown>),
    update: (poolid: string, params: Partial<PoolParams>) =>
      proxmox.put<null>(`pools/${encodeURIComponent(poolid)}`, params as Record<string, unknown>),
    delete: (poolid: string) =>
      proxmox.delete<null>(`pools/${encodeURIComponent(poolid)}`),
  },
};

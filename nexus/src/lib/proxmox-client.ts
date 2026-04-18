/**
 * Proxmox API Client
 * Thin fetch wrapper that routes through the local Next.js proxy (/api/proxmox/...)
 * All auth state is carried via httpOnly cookie — this client is safe to use
 * from both client and server components.
 */

import type { PveBool } from '@/types/proxmox';

// ─── PVE Boolean Codec ────────────────────────────────────────────────────────
//
// Proxmox's HTTP API accepts integer 0/1 for boolean flags. Consumers should
// express these as native `boolean` and call through the codec only at the
// HTTP boundary — never in UI state or JSX equality checks.

export function toPveBool(v: boolean): PveBool;
export function toPveBool(v: boolean | undefined): PveBool | undefined;
export function toPveBool(v: boolean | undefined): PveBool | undefined {
  return v === undefined ? undefined : v ? (1 as PveBool) : (0 as PveBool);
}

// PVE returns booleans as one of: 1 / 0 (numeric, the documented default),
// true / false (some endpoints), '1' / '0' (form-POST echoes — silently
// treated as `false` by the prior implementation, which was the read-path
// leak the audit flagged). null/undefined collapse to false. Any other
// value is a wire-shape regression that should fail loud rather than
// silently falsy.
export function fromPveBool(v: number | boolean | string | null | undefined): boolean {
  if (v === 1 || v === '1' || v === true) return true;
  if (v === 0 || v === '0' || v === false || v === null || v === undefined) return false;
  // Throwing here would cascade into 500s on PVE schema drift; coerce to
  // false (fail-closed for permission-shaped flags) and log loudly so the
  // operator can spot the upstream change in the journal.
  console.error('[fromPveBool] unexpected wire value: type=%s value=%s', typeof v, String(v));
  return false;
}

/**
 * Return a shallow copy of `obj` with each listed key's boolean value encoded
 * as `PveBool`. Keys whose value is `undefined` are preserved as `undefined`.
 * Non-listed keys pass through unchanged.
 */
export function encodeBoolFields<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): { [P in keyof T]: P extends K ? PveBool | undefined : T[P] } {
  const out = { ...obj } as Record<PropertyKey, unknown>;
  for (const k of keys) {
    const v = obj[k];
    out[k as PropertyKey] = v === undefined ? undefined : v ? (1 as PveBool) : (0 as PveBool);
  }
  return out as { [P in keyof T]: P extends K ? PveBool | undefined : T[P] };
}

/**
 * Inverse of `encodeBoolFields`. Decodes each listed key from `PveBool` to
 * `boolean`. `undefined` survives. Useful for normalising response payloads.
 */
export function decodeBoolFields<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): { [P in keyof T]: P extends K ? boolean | undefined : T[P] } {
  const out = { ...obj } as Record<PropertyKey, unknown>;
  for (const k of keys) {
    const v = obj[k];
    // Route through fromPveBool so the '0'/'1' string handling stays in
    // exactly one place (Phase H). `undefined` passes through unchanged
    // so optional fields stay optional after decode.
    out[k as PropertyKey] =
      v === undefined ? undefined : fromPveBool(v as number | boolean | string | null);
  }
  return out as { [P in keyof T]: P extends K ? boolean | undefined : T[P] };
}

// ─── Firewall Codec Bindings ──────────────────────────────────────────────────

/** Keys on FirewallOptions that carry PveBool on the wire. Kept beside the
 *  codec so the encode/decode sites share a single source of truth. The
 *  `satisfies` clause compile-errors if a key is misspelled or removed from
 *  the interface. */
const FIREWALL_OPTIONS_BOOL_KEYS = [
  'enable',
  'ebtables',
  'nosmurfs',
  'tcpflags',
  'macfilter',
  'dhcp',
  'ipfilter',
  'ndp',
  'radv',
] as const satisfies readonly (keyof FirewallOptions)[];

const decodeFirewallOptions = (raw: FirewallOptions): FirewallOptionsPublic =>
  decodeBoolFields(raw, FIREWALL_OPTIONS_BOOL_KEYS) as FirewallOptionsPublic;

const encodeFirewallOptions = (
  opts: Partial<FirewallOptionsPublic>,
): Record<string, unknown> =>
  encodeBoolFields(opts, FIREWALL_OPTIONS_BOOL_KEYS) as Record<string, unknown>;

// ─── Storage / Restore Codec Bindings ─────────────────────────────────────────

const STORAGE_CREATE_BOOL_KEYS = ['mkdir'] as const satisfies
  readonly (keyof StorageCreatePayload)[];

const DISK_LIST_BOOL_KEYS = ['gpt'] as const satisfies
  readonly (keyof DiskListEntry)[];

const RESTORE_BOOL_KEYS = ['force', 'unique', 'start'] as const satisfies
  readonly (keyof RestoreParams)[];

const encodeStorageCreate = (
  payload: Partial<StorageCreatePayloadPublic>,
): Record<string, unknown> =>
  encodeBoolFields(payload, STORAGE_CREATE_BOOL_KEYS) as Record<string, unknown>;

const encodeStorageUpdate = (
  payload: StorageUpdatePayloadPublic,
): Record<string, unknown> =>
  encodeBoolFields(payload, STORAGE_CREATE_BOOL_KEYS) as Record<string, unknown>;

const decodeStorageConfig = (raw: PVEStorageConfig): PVEStorageConfigPublic =>
  decodeBoolFields(raw, STORAGE_CREATE_BOOL_KEYS) as PVEStorageConfigPublic;

const decodeDiskList = (rows: DiskListEntry[]): DiskListEntryPublic[] =>
  rows.map((r) => decodeBoolFields(r, DISK_LIST_BOOL_KEYS) as DiskListEntryPublic);

const encodeRestore = (
  params: RestoreParamsPublic,
): Record<string, unknown> =>
  encodeBoolFields(params, RESTORE_BOOL_KEYS) as Record<string, unknown>;

// ─── HA / Cluster Status Codec Bindings ───────────────────────────────────────

const HA_GROUP_BOOL_KEYS = ['restricted', 'nofailback'] as const satisfies
  readonly (keyof HAGroup)[];

const HA_STATUS_BOOL_KEYS = ['quorate'] as const satisfies
  readonly (keyof HAStatus)[];

const CLUSTER_STATUS_BOOL_KEYS = ['quorate', 'online', 'local'] as const satisfies
  readonly (keyof ClusterStatus)[];

const decodeHAGroup = (raw: HAGroup): HAGroupPublic =>
  decodeBoolFields(raw, HA_GROUP_BOOL_KEYS) as HAGroupPublic;

const encodeHAGroupParams = (
  params: Partial<HAGroupParamsPublic>,
): Record<string, unknown> =>
  encodeBoolFields(params, HA_GROUP_BOOL_KEYS) as Record<string, unknown>;

const decodeHAStatus = (rows: HAStatus[]): HAStatusPublic[] =>
  rows.map((r) => decodeBoolFields(r, HA_STATUS_BOOL_KEYS) as HAStatusPublic);

const decodeClusterStatus = (rows: ClusterStatus[]): ClusterStatusPublic[] =>
  rows.map((r) => decodeBoolFields(r, CLUSTER_STATUS_BOOL_KEYS) as ClusterStatusPublic);

// ─── Access Codec Bindings ────────────────────────────────────────────────────

const USER_BOOL_KEYS = ['enable'] as const satisfies readonly (keyof PVEUser)[];
const ROLE_BOOL_KEYS = ['special'] as const satisfies readonly (keyof PVERole)[];
const REALM_BOOL_KEYS = ['default', 'secure', 'autocreate'] as const satisfies
  readonly (keyof PVERealm)[];
const ACL_BOOL_KEYS = ['propagate'] as const satisfies readonly (keyof PVEACL)[];
const ACL_PARAMS_BOOL_KEYS = ['propagate', 'delete'] as const satisfies
  readonly (keyof ACLParams)[];

const decodeUser = (raw: PVEUser): PVEUserPublic =>
  decodeBoolFields(raw, USER_BOOL_KEYS) as PVEUserPublic;

const encodeUserParams = (
  params: Partial<UserParamsPublic>,
): Record<string, unknown> =>
  encodeBoolFields(params, USER_BOOL_KEYS) as Record<string, unknown>;

const decodeRole = (raw: PVERole): PVERolePublic =>
  decodeBoolFields(raw, ROLE_BOOL_KEYS) as PVERolePublic;

const decodeRealm = (raw: PVERealm): PVERealmPublic =>
  decodeBoolFields(raw, REALM_BOOL_KEYS) as PVERealmPublic;

const encodeRealmParams = (
  params: Partial<RealmParamsPublic>,
): Record<string, unknown> =>
  encodeBoolFields(params, REALM_BOOL_KEYS) as Record<string, unknown>;

const decodeAcl = (rows: PVEACL[]): PVEACLPublic[] =>
  rows.map((r) => decodeBoolFields(r, ACL_BOOL_KEYS) as PVEACLPublic);

const encodeAclParams = (
  params: ACLParamsPublic,
): Record<string, unknown> =>
  encodeBoolFields(params, ACL_PARAMS_BOOL_KEYS) as Record<string, unknown>;

// ─── VM / CT Codec Bindings ───────────────────────────────────────────────────
//
// Config flags (onboot, protection, template) default to *false* in PVE when
// absent — opposite semantic from user.enable. Reads use `?? false`, not
// `!== false`.

const VM_CONFIG_BOOL_KEYS = ['onboot', 'protection', 'template'] as const satisfies
  readonly (keyof VMConfig)[];
const CT_CONFIG_BOOL_KEYS = ['onboot', 'protection', 'template'] as const satisfies
  readonly (keyof CTConfig)[];
const UPDATE_VM_CONFIG_BOOL_KEYS = ['onboot', 'protection', 'template'] as const satisfies
  readonly (keyof UpdateVMConfigParams)[];
const UPDATE_CT_CONFIG_BOOL_KEYS = ['onboot', 'protection', 'template'] as const satisfies
  readonly (keyof UpdateCTConfigParams)[];
const CLONE_VM_BOOL_KEYS = ['full'] as const satisfies readonly (keyof CloneVMParams)[];
const MIGRATE_VM_BOOL_KEYS = ['online', 'with_local_disks'] as const satisfies
  readonly (keyof MigrateVMParams)[];
const MIGRATE_CT_BOOL_KEYS = ['online', 'restart'] as const satisfies
  readonly (keyof MigrateCTParams)[];

const decodeVMConfig = (raw: VMConfigFull): VMConfigFullPublic =>
  decodeBoolFields(raw, VM_CONFIG_BOOL_KEYS) as VMConfigFullPublic;

const decodeCTConfig = (raw: CTConfig): CTConfigPublic =>
  decodeBoolFields(raw, CT_CONFIG_BOOL_KEYS) as CTConfigPublic;

const encodeUpdateVMConfig = (
  params: Partial<UpdateVMConfigParamsPublic>,
): Record<string, unknown> => {
  const out = encodeBoolFields(params, UPDATE_VM_CONFIG_BOOL_KEYS) as Record<
    string,
    unknown
  >;
  // PVE's cloud-init parser wants sshkeys as a URL-encoded newline-separated
  // list. Callers pass literal newlines; we encode here so every call site
  // stays string-in / string-out.
  if (typeof out.sshkeys === 'string' && out.sshkeys.length > 0) {
    out.sshkeys = encodeURIComponent(out.sshkeys);
  }
  return out;
};

const encodeUpdateCTConfig = (
  params: Partial<UpdateCTConfigParamsPublic>,
): Record<string, unknown> =>
  encodeBoolFields(params, UPDATE_CT_CONFIG_BOOL_KEYS) as Record<string, unknown>;

const encodeCloneVM = (params: CloneVMParamsPublic): Record<string, unknown> =>
  encodeBoolFields(params, CLONE_VM_BOOL_KEYS) as Record<string, unknown>;

const encodeMigrateVM = (params: MigrateVMParamsPublic): Record<string, unknown> =>
  encodeBoolFields(params, MIGRATE_VM_BOOL_KEYS) as Record<string, unknown>;

const encodeMigrateCT = (params: MigrateCTParamsPublic): Record<string, unknown> =>
  encodeBoolFields(params, MIGRATE_CT_BOOL_KEYS) as Record<string, unknown>;

// ─── B6: Backup / Snapshot / Firewall-Rule / CT-Create / Network Bindings ────
//
// Per-field semantic defaults (absent = ?):
//   BackupJob.enabled, FirewallRule.enable, NetworkIface.autostart  → true
//   BackupFile.protected, PVESnapshot.vmstate, .running, nomatch,
//   CreateCTParams.unprivileged                                      → false
// The codec is symmetric either way; consumer read idioms distinguish
// (`!== false` vs `?? false`).

const BACKUP_JOB_BOOL_KEYS = ['enabled', 'all', 'remove', 'protected'] as const satisfies readonly (keyof BackupJob)[];
const BACKUP_FILE_BOOL_KEYS = ['protected'] as const satisfies readonly (keyof BackupFile)[];
const VZDUMP_BOOL_KEYS = ['all', 'protected', 'remove'] as const satisfies readonly (keyof VzdumpParams)[];
const SNAPSHOT_BOOL_KEYS = ['vmstate', 'running'] as const satisfies readonly (keyof PVESnapshot)[];
const CREATE_SNAPSHOT_BOOL_KEYS = ['vmstate'] as const satisfies readonly (keyof CreateSnapshotParams)[];
const FIREWALL_RULE_BOOL_KEYS = ['enable'] as const satisfies readonly (keyof FirewallRule)[];
const IPSET_ENTRY_BOOL_KEYS = ['nomatch'] as const satisfies readonly (keyof FirewallIPSetEntry)[];
const CREATE_CT_BOOL_KEYS = ['unprivileged'] as const satisfies readonly (keyof CreateCTParams)[];
const NETWORK_IFACE_BOOL_KEYS = ['autostart', 'active'] as const satisfies readonly (keyof NetworkIface)[];
const NETWORK_IFACE_PARAMS_BOOL_KEYS = ['autostart'] as const satisfies readonly (keyof NetworkIfaceParams)[];

const decodeBackupJob = (raw: BackupJob): BackupJobPublic =>
  decodeBoolFields(raw, BACKUP_JOB_BOOL_KEYS) as BackupJobPublic;
const encodeBackupJobParams = (p: BackupJobParamsPublic): Record<string, unknown> =>
  encodeBoolFields(p, BACKUP_JOB_BOOL_KEYS) as Record<string, unknown>;
const decodeBackupFile = (raw: BackupFile): BackupFilePublic =>
  decodeBoolFields(raw, BACKUP_FILE_BOOL_KEYS) as BackupFilePublic;
const encodeVzdump = (p: VzdumpParamsPublic): Record<string, unknown> =>
  encodeBoolFields(p, VZDUMP_BOOL_KEYS) as Record<string, unknown>;

const decodeSnapshot = (raw: PVESnapshot): PVESnapshotPublic =>
  decodeBoolFields(raw, SNAPSHOT_BOOL_KEYS) as PVESnapshotPublic;
const encodeCreateSnapshot = (p: CreateSnapshotParamsPublic): Record<string, unknown> =>
  encodeBoolFields(p, CREATE_SNAPSHOT_BOOL_KEYS) as Record<string, unknown>;

const decodeFirewallRule = (raw: FirewallRule): FirewallRulePublic =>
  decodeBoolFields(raw, FIREWALL_RULE_BOOL_KEYS) as FirewallRulePublic;
const encodeFirewallRuleParams = (p: FirewallRuleParamsPublic): Record<string, unknown> =>
  encodeBoolFields(p, FIREWALL_RULE_BOOL_KEYS) as Record<string, unknown>;
const decodeIPSetEntry = (raw: FirewallIPSetEntry): FirewallIPSetEntryPublic =>
  decodeBoolFields(raw, IPSET_ENTRY_BOOL_KEYS) as FirewallIPSetEntryPublic;

const encodeCreateCT = (p: Omit<CreateCTParamsPublic, 'node'>): Record<string, unknown> =>
  encodeBoolFields(p, CREATE_CT_BOOL_KEYS) as Record<string, unknown>;

const decodeNetworkIface = (raw: NetworkIface): NetworkIfacePublic =>
  decodeBoolFields(raw, NETWORK_IFACE_BOOL_KEYS) as NetworkIfacePublic;
const encodeNetworkIfaceParams = (p: Partial<NetworkIfaceParamsPublic>): Record<string, unknown> =>
  encodeBoolFields(p, NETWORK_IFACE_PARAMS_BOOL_KEYS) as Record<string, unknown>;

// ─── B7: Residue cleanup — list-endpoint list types ──────────────────────────

const PVE_STORAGE_BOOL_KEYS = ['shared', 'active', 'enabled'] as const satisfies
  readonly (keyof PVEStorage)[];
const CLUSTER_RESOURCE_BOOL_KEYS = ['template', 'shared'] as const satisfies
  readonly (keyof ClusterResource)[];

const decodePveStorage = (raw: PVEStorage): PVEStoragePublic =>
  decodeBoolFields(raw, PVE_STORAGE_BOOL_KEYS) as PVEStoragePublic;

const decodeClusterResource = (raw: ClusterResource): ClusterResourcePublic =>
  decodeBoolFields(raw, CLUSTER_RESOURCE_BOOL_KEYS) as ClusterResourcePublic;

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
  ClusterResourcePublic,
  PVENode,
  NodeStatus,
  PVEVM,
  PVECT,
  PVEStorage,
  PVEStoragePublic,
  PVETask,
  VNCProxyResponse,
  NodeRRDData,
  StorageRRDData,
  VMConfig,
  VMConfigFull,
  VMConfigFullPublic,
  CTConfig,
  CTConfigPublic,
  StorageContent,
  NodeNetwork,
  CreateVMParams,
  CreateCTParams,
  CreateCTParamsPublic,
  CloneVMParams,
  CloneVMParamsPublic,
  CloneCTParams,
  MigrateVMParams,
  MigrateVMParamsPublic,
  MigrateCTParams,
  MigrateCTParamsPublic,
  MigratePrecondition,
  UpdateVMConfigParams,
  UpdateVMConfigParamsPublic,
  UpdateCTConfigParams,
  UpdateCTConfigParamsPublic,
  NodePowerCommand,
  AptInstalledPackage,
  AptUpdatablePackage,
  NetworkIface,
  NetworkIfacePublic,
  NetworkIfaceParams,
  NetworkIfaceParamsPublic,
  CertificateInfo,
  AcmeAccount,
  JournalEntry,
  JournalParams,
  PVESnapshot,
  PVESnapshotPublic,
  CreateSnapshotParams,
  CreateSnapshotParamsPublic,
  BackupJob,
  BackupJobPublic,
  BackupJobParams,
  BackupJobParamsPublic,
  BackupFile,
  BackupFilePublic,
  VzdumpParams,
  VzdumpParamsPublic,
  RestoreParams,
  IsoUploadParams,
  DownloadUrlParams,
  StorageContentType,
  FirewallRule,
  FirewallRulePublic,
  FirewallRuleParams,
  FirewallRuleParamsPublic,
  FirewallAlias,
  FirewallIPSet,
  FirewallIPSetEntry,
  FirewallIPSetEntryPublic,
  FirewallGroup,
  FirewallOptions,
  FirewallOptionsPublic,
  StorageCreatePayloadPublic,
  StorageUpdatePayloadPublic,
  PVEStorageConfigPublic,
  DiskListEntryPublic,
  RestoreParamsPublic,
  PVEUser,
  PVEUserPublic,
  UserParamsPublic,
  PVEGroup,
  GroupParams,
  PVERole,
  RoleParams,
  PVERealm,
  PVERealmPublic,
  RealmParamsPublic,
  PVERolePublic,
  PVEACL,
  PVEACLPublic,
  ACLParams,
  ACLParamsPublic,
  HAResource,
  HAResourceParams,
  HAGroup,
  HAGroupPublic,
  HAGroupParamsPublic,
  HAStatus,
  HAStatusPublic,
  ClusterStatus,
  ClusterStatusPublic,
  PVEPool,
  PoolParams,
  DiskListEntry,
  SmartData,
  StorageCreatePayload,
  StorageUpdatePayload,
  PVEStorageConfig,
} from '@/types/proxmox';
import type {
  NasShare,
  NasService,
  CreateNasSharePayload,
  FileNode,
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
    config: async (node: string, vmid: number): Promise<VMConfigFullPublic> =>
      decodeVMConfig(
        await proxmox.get<VMConfigFull>(`nodes/${node}/qemu/${vmid}/config`),
      ),
    updateConfig: (node: string, vmid: number, params: Partial<UpdateVMConfigParamsPublic>) =>
      proxmox.put<null>(
        `nodes/${node}/qemu/${vmid}/config`,
        encodeUpdateVMConfig(params),
      ),
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
    clone: (node: string, vmid: number, params: CloneVMParamsPublic) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/clone`, encodeCloneVM(params)),
    migrate: (node: string, vmid: number, params: MigrateVMParamsPublic) =>
      proxmox.post<string>(`nodes/${node}/qemu/${vmid}/migrate`, encodeMigrateVM(params)),
    /** PVE precondition check — returns allowed/not-allowed target nodes
     *  and any local-disk/-resource obstacles. Call BEFORE migrate so the
     *  wizard can filter + explain unreachable targets. */
    migratePrecondition: (node: string, vmid: number) =>
      proxmox.get<MigratePrecondition>(`nodes/${node}/qemu/${vmid}/migrate`),
    create: (node: string, params: Omit<CreateVMParams, 'node'>) =>
      proxmox.post<string>(`nodes/${node}/qemu`, params as Record<string, unknown>),
    vncproxy: (node: string, vmid: number) =>
      proxmox.post<VNCProxyResponse>(`nodes/${node}/qemu/${vmid}/vncproxy`, { websocket: 1 }),
    rrd: (node: string, vmid: number, timeframe: 'hour' | 'day' | 'week' = 'hour') =>
      proxmox.get<NodeRRDData[]>(`nodes/${node}/qemu/${vmid}/rrddata?timeframe=${timeframe}&cf=AVERAGE`),
    snapshot: {
      list: async (node: string, vmid: number): Promise<PVESnapshotPublic[]> =>
        (await proxmox.get<PVESnapshot[]>(`nodes/${node}/qemu/${vmid}/snapshot`)).map(decodeSnapshot),
      create: (node: string, vmid: number, params: CreateSnapshotParamsPublic) =>
        proxmox.post<string>(`nodes/${node}/qemu/${vmid}/snapshot`, encodeCreateSnapshot(params)),
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
    config: async (node: string, vmid: number): Promise<CTConfigPublic> =>
      decodeCTConfig(
        await proxmox.get<CTConfig>(`nodes/${node}/lxc/${vmid}/config`),
      ),
    updateConfig: (node: string, vmid: number, params: Partial<UpdateCTConfigParamsPublic>) =>
      proxmox.put<null>(
        `nodes/${node}/lxc/${vmid}/config`,
        encodeUpdateCTConfig(params),
      ),
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
    migrate: (node: string, vmid: number, params: MigrateCTParamsPublic) =>
      proxmox.post<string>(`nodes/${node}/lxc/${vmid}/migrate`, encodeMigrateCT(params)),
    migratePrecondition: (node: string, vmid: number) =>
      proxmox.get<MigratePrecondition>(`nodes/${node}/lxc/${vmid}/migrate`),
    create: (node: string, params: Omit<CreateCTParamsPublic, 'node'>) =>
      proxmox.post<string>(`nodes/${node}/lxc`, encodeCreateCT(params)),
    vncproxy: (node: string, vmid: number) =>
      proxmox.post<VNCProxyResponse>(`nodes/${node}/lxc/${vmid}/vncproxy`, { websocket: 1 }),
    rrd: (node: string, vmid: number, timeframe: 'hour' | 'day' | 'week' = 'hour') =>
      proxmox.get<NodeRRDData[]>(`nodes/${node}/lxc/${vmid}/rrddata?timeframe=${timeframe}&cf=AVERAGE`),
    snapshot: {
      list: async (node: string, vmid: number): Promise<PVESnapshotPublic[]> =>
        (await proxmox.get<PVESnapshot[]>(`nodes/${node}/lxc/${vmid}/snapshot`)).map(decodeSnapshot),
      create: (node: string, vmid: number, params: CreateSnapshotParamsPublic) =>
        proxmox.post<string>(`nodes/${node}/lxc/${vmid}/snapshot`, encodeCreateSnapshot(params)),
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
    list: async (node: string): Promise<PVEStoragePublic[]> =>
      (await proxmox.get<PVEStorage[]>(`nodes/${node}/storage`)).map(decodePveStorage),
    /** Cluster-wide: create a new storage pool. Hits POST /storage (not a
     *  per-node path) — the pool appears on every listed node once PVE's
     *  config is replicated. CSRF is handled by the shared `request<T>`
     *  wrapper inside `proxmox.post`. */
    create: (payload: StorageCreatePayloadPublic): Promise<null> =>
      proxmox.post<null>('storage', encodeStorageCreate(payload)),
    /** Cluster-wide: fetch the full persisted config for one storage pool.
     *  Used by the Edit flow to pre-fill the dialog with fields the list
     *  endpoint (GET /nodes/{node}/storage) doesn't include (server, export, …). */
    get: async (id: string): Promise<PVEStorageConfigPublic> =>
      decodeStorageConfig(
        await proxmox.get<PVEStorageConfig>(`storage/${encodeURIComponent(id)}`),
      ),
    /** Cluster-wide: patch a storage pool. PVE rejects changes to the ID or
     *  backend type, so callers must strip those from the payload. CSRF is
     *  added by `proxmox.put`. */
    update: (id: string, payload: StorageUpdatePayloadPublic): Promise<null> =>
      proxmox.put<null>(
        `storage/${encodeURIComponent(id)}`,
        encodeStorageUpdate(payload),
      ),
    /** Cluster-wide: detach a storage pool from PVE. Data on the underlying
     *  share is left untouched — PVE only removes the config entry. */
    delete: (id: string): Promise<null> =>
      proxmox.delete<null>(`storage/${encodeURIComponent(id)}`),
    listWithContent: (node: string, content: string) =>
      (proxmox.get<PVEStorage[]>(`nodes/${node}/storage?content=${content}`).then((rows) => rows.map(decodePveStorage))),
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
    /** Historical used/total/avail bytes per storage pool. Used by the NOC
     *  view's exhaustion projection — 'week' is a good default (70 samples
     *  @ ~2.4h each; enough slope without months-old noise). */
    rrd: (
      node: string,
      storage: string,
      timeframe: 'hour' | 'day' | 'week' | 'month' = 'week',
    ) =>
      proxmox.get<StorageRRDData[]>(
        `nodes/${node}/storage/${encodeURIComponent(storage)}/rrddata?timeframe=${timeframe}&cf=AVERAGE`,
      ),
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
    list: async (node: string): Promise<DiskListEntryPublic[]> =>
      decodeDiskList(
        await proxmox.get<DiskListEntry[]>(`nodes/${node}/disks/list`),
      ),
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

    browse: (node: string, shareId: string, path: string = ''): Promise<FileNode[]> =>
      nasRequest<{ files: FileNode[] }>(
        `/api/nas/browse?node=${encodeURIComponent(node)}&shareId=${encodeURIComponent(shareId)}&path=${encodeURIComponent(path)}`,
      ).then((r) => r.files),

    /**
     * Download a single file. Returns the raw `Response` — the endpoint emits
     * `application/octet-stream`, so we can't go through `nasRequest` (which
     * would try JSON-parsing the body). Caller calls `.blob()` / `.body` as
     * needed. Non-2xx responses are translated to `ProxmoxAPIError` with the
     * server's error message surfaced through the JSON envelope.
     */
    download: async (node: string, shareId: string, path: string): Promise<Response> => {
      const url = `/api/nas/download?node=${encodeURIComponent(node)}&shareId=${encodeURIComponent(shareId)}&path=${encodeURIComponent(path)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const body = await res.json();
          message = body?.error ?? body?.message ?? message;
        } catch {
          // non-JSON error body — stick with statusText
        }
        throw new ProxmoxAPIError(res.status, res.statusText, message);
      }
      return res;
    },
  },

  // Cluster
  cluster: {
    resources: async (): Promise<ClusterResourcePublic[]> =>
      (await proxmox.get<ClusterResource[]>('cluster/resources')).map(decodeClusterResource),
    tasks: () => proxmox.get<PVETask[]>('cluster/tasks'),
    nextid: () => proxmox.get<number>('cluster/nextid'),
    status: async (): Promise<ClusterStatusPublic[]> =>
      decodeClusterStatus(await proxmox.get<ClusterStatus[]>('cluster/status')),
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
    /** Single-UPID status probe. The returned object carries `status`
     *  ('running' | 'stopped') and `exitstatus` ('OK' | <reason>). Used
     *  by useTaskCompletion to await long-running ops like clone. */
    taskStatus: (node: string, upid: string) =>
      proxmox.get<PVETask>(`nodes/${node}/tasks/${encodeURIComponent(upid)}/status`),
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
      list: async (): Promise<BackupJobPublic[]> =>
        (await proxmox.get<BackupJob[]>('cluster/backup')).map(decodeBackupJob),
      get: async (id: string): Promise<BackupJobPublic> =>
        decodeBackupJob(await proxmox.get<BackupJob>(`cluster/backup/${encodeURIComponent(id)}`)),
      create: (params: BackupJobParamsPublic) =>
        proxmox.post<null>('cluster/backup', encodeBackupJobParams(params)),
      update: (id: string, params: BackupJobParamsPublic) =>
        proxmox.put<null>(`cluster/backup/${encodeURIComponent(id)}`, encodeBackupJobParams(params)),
      delete: (id: string) =>
        proxmox.delete<null>(`cluster/backup/${encodeURIComponent(id)}`),
    },
    vzdump: (node: string, params: VzdumpParamsPublic) =>
      proxmox.post<string>(`nodes/${node}/vzdump`, encodeVzdump(params)),
    files: async (node: string, storage: string): Promise<BackupFilePublic[]> =>
      (await proxmox.get<BackupFile[]>(`nodes/${node}/storage/${encodeURIComponent(storage)}/content?content=backup`)).map(decodeBackupFile),
    delete: (node: string, storage: string, volid: string) =>
      proxmox.delete<null>(`nodes/${node}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`),
    restoreVM: (node: string, params: RestoreParamsPublic) =>
      proxmox.post<string>(`nodes/${node}/qemu`, encodeRestore(params)),
    restoreCT: (node: string, params: RestoreParamsPublic) =>
      proxmox.post<string>(`nodes/${node}/lxc`, encodeRestore(params)),
    protect: (node: string, storage: string, volid: string, isProtected: boolean) =>
      proxmox.put<null>(
        `nodes/${node}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`,
        { protected: toPveBool(isProtected) },
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
    list: async (node: string): Promise<NetworkIfacePublic[]> =>
      (await proxmox.get<NetworkIface[]>(`nodes/${node}/network`)).map(decodeNetworkIface),
    get: async (node: string, iface: string): Promise<NetworkIfacePublic> =>
      decodeNetworkIface(await proxmox.get<NetworkIface>(`nodes/${node}/network/${iface}`)),
    create: (node: string, params: NetworkIfaceParamsPublic) =>
      proxmox.post<string>(`nodes/${node}/network`, encodeNetworkIfaceParams(params)),
    update: (node: string, iface: string, params: Partial<NetworkIfaceParamsPublic>) =>
      proxmox.put<string>(`nodes/${node}/network/${iface}`, encodeNetworkIfaceParams(params)),
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
        list: async (): Promise<FirewallRulePublic[]> => (await proxmox.get<FirewallRule[]>('cluster/firewall/rules')).map(decodeFirewallRule),
        get: async (pos: number): Promise<FirewallRulePublic> => decodeFirewallRule(await proxmox.get<FirewallRule>(`cluster/firewall/rules/${pos}`)),
        create: (params: FirewallRuleParamsPublic) =>
          proxmox.post<null>('cluster/firewall/rules', encodeFirewallRuleParams(params)),
        update: (pos: number, params: FirewallRuleParamsPublic) =>
          proxmox.put<null>(`cluster/firewall/rules/${pos}`, encodeFirewallRuleParams(params)),
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
        addRule: (name: string, params: FirewallRuleParamsPublic) =>
          proxmox.post<null>(
            `cluster/firewall/groups/${encodeURIComponent(name)}`,
            encodeFirewallRuleParams(params),
          ),
      },
      options: {
        get: async (): Promise<FirewallOptionsPublic> =>
          decodeFirewallOptions(
            await proxmox.get<FirewallOptions>('cluster/firewall/options'),
          ),
        update: (opts: Partial<FirewallOptionsPublic>) =>
          proxmox.put<null>('cluster/firewall/options', encodeFirewallOptions(opts)),
      },
    },
    node: {
      rules: {
        list: async (node: string): Promise<FirewallRulePublic[]> => (await proxmox.get<FirewallRule[]>(`nodes/${node}/firewall/rules`)).map(decodeFirewallRule),
        create: (node: string, params: FirewallRuleParamsPublic) =>
          proxmox.post<null>(`nodes/${node}/firewall/rules`, encodeFirewallRuleParams(params)),
        update: (node: string, pos: number, params: FirewallRuleParamsPublic) =>
          proxmox.put<null>(`nodes/${node}/firewall/rules/${pos}`, encodeFirewallRuleParams(params)),
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
        get: async (node: string): Promise<FirewallOptionsPublic> =>
          decodeFirewallOptions(
            await proxmox.get<FirewallOptions>(`nodes/${node}/firewall/options`),
          ),
        update: (node: string, opts: Partial<FirewallOptionsPublic>) =>
          proxmox.put<null>(
            `nodes/${node}/firewall/options`,
            encodeFirewallOptions(opts),
          ),
      },
    },
    vm: {
      rules: {
        list: async (node: string, vmid: number): Promise<FirewallRulePublic[]> =>
          (await proxmox.get<FirewallRule[]>(`nodes/${node}/qemu/${vmid}/firewall/rules`)).map(decodeFirewallRule),
        create: (node: string, vmid: number, params: FirewallRuleParamsPublic) =>
          proxmox.post<null>(`nodes/${node}/qemu/${vmid}/firewall/rules`, encodeFirewallRuleParams(params)),
        update: (node: string, vmid: number, pos: number, params: FirewallRuleParamsPublic) =>
          proxmox.put<null>(
            `nodes/${node}/qemu/${vmid}/firewall/rules/${pos}`,
            encodeFirewallRuleParams(params),
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
        get: async (node: string, vmid: number): Promise<FirewallOptionsPublic> =>
          decodeFirewallOptions(
            await proxmox.get<FirewallOptions>(
              `nodes/${node}/qemu/${vmid}/firewall/options`,
            ),
          ),
        update: (node: string, vmid: number, opts: Partial<FirewallOptionsPublic>) =>
          proxmox.put<null>(
            `nodes/${node}/qemu/${vmid}/firewall/options`,
            encodeFirewallOptions(opts),
          ),
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
        list: async (node: string, vmid: number): Promise<FirewallRulePublic[]> =>
          (await proxmox.get<FirewallRule[]>(`nodes/${node}/lxc/${vmid}/firewall/rules`)).map(decodeFirewallRule),
        create: (node: string, vmid: number, params: FirewallRuleParamsPublic) =>
          proxmox.post<null>(`nodes/${node}/lxc/${vmid}/firewall/rules`, encodeFirewallRuleParams(params)),
        update: (node: string, vmid: number, pos: number, params: FirewallRuleParamsPublic) =>
          proxmox.put<null>(
            `nodes/${node}/lxc/${vmid}/firewall/rules/${pos}`,
            encodeFirewallRuleParams(params),
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
        get: async (node: string, vmid: number): Promise<FirewallOptionsPublic> =>
          decodeFirewallOptions(
            await proxmox.get<FirewallOptions>(
              `nodes/${node}/lxc/${vmid}/firewall/options`,
            ),
          ),
        update: (node: string, vmid: number, opts: Partial<FirewallOptionsPublic>) =>
          proxmox.put<null>(
            `nodes/${node}/lxc/${vmid}/firewall/options`,
            encodeFirewallOptions(opts),
          ),
      },
    },
  },

  access: {
    users: {
      list: async (): Promise<PVEUserPublic[]> => {
        const rows = await proxmox.get<PVEUser[]>('access/users');
        return rows.map(decodeUser);
      },
      get: async (userid: string): Promise<PVEUserPublic> =>
        decodeUser(
          await proxmox.get<PVEUser>(`access/users/${encodeURIComponent(userid)}`),
        ),
      create: (params: UserParamsPublic) =>
        proxmox.post<null>('access/users', encodeUserParams(params)),
      update: (userid: string, params: Partial<UserParamsPublic>) =>
        proxmox.put<null>(
          `access/users/${encodeURIComponent(userid)}`,
          encodeUserParams(params),
        ),
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
      list: async (): Promise<PVERolePublic[]> => {
        const rows = await proxmox.get<PVERole[]>('access/roles');
        return rows.map(decodeRole);
      },
      get: async (roleid: string): Promise<PVERolePublic> =>
        decodeRole(
          await proxmox.get<PVERole>(`access/roles/${encodeURIComponent(roleid)}`),
        ),
      create: (params: RoleParams) =>
        proxmox.post<null>('access/roles', params as Record<string, unknown>),
      update: (roleid: string, params: Partial<RoleParams>) =>
        proxmox.put<null>(`access/roles/${encodeURIComponent(roleid)}`, params as Record<string, unknown>),
      delete: (roleid: string) =>
        proxmox.delete<null>(`access/roles/${encodeURIComponent(roleid)}`),
    },
    realms: {
      list: async (): Promise<PVERealmPublic[]> => {
        const rows = await proxmox.get<PVERealm[]>('access/domains');
        return rows.map(decodeRealm);
      },
      get: async (realm: string): Promise<PVERealmPublic> =>
        decodeRealm(
          await proxmox.get<PVERealm>(`access/domains/${encodeURIComponent(realm)}`),
        ),
      create: (params: RealmParamsPublic) =>
        proxmox.post<null>('access/domains', encodeRealmParams(params)),
      update: (realm: string, params: Partial<RealmParamsPublic>) =>
        proxmox.put<null>(
          `access/domains/${encodeURIComponent(realm)}`,
          encodeRealmParams(params),
        ),
      delete: (realm: string) =>
        proxmox.delete<null>(`access/domains/${encodeURIComponent(realm)}`),
      sync: (realm: string) =>
        proxmox.post<string>(`access/domains/${encodeURIComponent(realm)}/sync`),
    },
    acl: {
      list: async (): Promise<PVEACLPublic[]> =>
        decodeAcl(await proxmox.get<PVEACL[]>('access/acl')),
      update: (params: ACLParamsPublic) =>
        proxmox.put<null>('access/acl', encodeAclParams(params)),
    },
  },

  ha: {
    status: {
      current: async (): Promise<HAStatusPublic[]> =>
        decodeHAStatus(await proxmox.get<HAStatus[]>('cluster/ha/status/current')),
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
      list: async (): Promise<HAGroupPublic[]> => {
        const rows = await proxmox.get<HAGroup[]>('cluster/ha/groups');
        return rows.map(decodeHAGroup);
      },
      get: async (group: string): Promise<HAGroupPublic> =>
        decodeHAGroup(
          await proxmox.get<HAGroup>(`cluster/ha/groups/${encodeURIComponent(group)}`),
        ),
      create: (params: HAGroupParamsPublic) =>
        proxmox.post<null>('cluster/ha/groups', encodeHAGroupParams(params)),
      update: (group: string, params: Partial<HAGroupParamsPublic>) =>
        proxmox.put<null>(
          `cluster/ha/groups/${encodeURIComponent(group)}`,
          encodeHAGroupParams(params),
        ),
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

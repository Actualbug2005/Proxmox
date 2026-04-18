// ─── Proxmox Wire Primitives ──────────────────────────────────────────────────
//
// Proxmox's HTTP API uses integer 0/1 on the wire for boolean flags (ExtJS
// heritage). `PveBool` is the wire representation; consumers should use native
// `boolean` via the codec in `lib/proxmox-client.ts`.
//
// `PveBool` is NOMINALLY BRANDED — raw `0`/`1` literals are NOT assignable
// to it. The only producers are `toPveBool` and `encodeBoolFields` in the
// codec, both of which `as PveBool` cast internally. This guarantees that
// every wire value flowing out of the UI layer has passed through the
// codec at least once.
//
// `WireBool<T, K>` and `UnwireBool<T, K>` are mapped type helpers that flip
// specified keys of an interface between the two representations, used during
// the phased migration away from wire-shaped types in the UI layer.

declare const __brand: unique symbol;

/** Branded integer-boolean for the Proxmox HTTP wire protocol. Cannot be
 *  assigned raw numbers or booleans; values must be produced by the codec
 *  (`toPveBool`, `encodeBoolFields`) which `as PveBool` casts internally. */
export type PveBool = (0 | 1) & { readonly [__brand]: 'PveBool' };

// Homomorphic mapped types: iterating `keyof T` preserves optional markers,
// readonly-ness, and index signatures. Only keys in `K` are retyped.

export type WireBool<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? PveBool | undefined : T[P];
};

export type UnwireBool<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? boolean | undefined : T[P];
};

// ─── Proxmox API Response Types ───────────────────────────────────────────────

export interface PVEApiResponse<T> {
  data: T;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface PVETicketResponse {
  ticket: string;
  CSRFPreventionToken: string;
  username: string;
  clustername?: string;
}

export interface PVEAuthSession {
  ticket: string;
  csrfToken: string;
  username: string;
  proxmoxHost: string;
  /** Unix ms when the PVE ticket was issued (or last refreshed). Used by the
   *  proxy to trigger a proactive refresh before PVE's ~2h expiry lands. */
  ticketIssuedAt: number;
  /** Unix ms of the most recent FAILED renewal attempt. Drives the 30s
   *  back-off so a persistently-broken PVE doesn't get hammered on every
   *  request. Cleared on successful renewal. */
  lastRenewalAttemptAt?: number;
}

// ─── Cluster ──────────────────────────────────────────────────────────────────

export type ResourceType = 'node' | 'qemu' | 'lxc' | 'storage' | 'pool' | 'sdn' | 'network';

export interface ClusterResource {
  id: string;
  type: ResourceType;
  node?: string;
  name?: string;
  status?: string;
  // VM/CT fields
  vmid?: number;
  maxcpu?: number;
  cpu?: number;
  maxmem?: number;
  mem?: number;
  maxdisk?: number;
  disk?: number;
  uptime?: number;
  netin?: number;
  netout?: number;
  template?: PveBool;
  // Node fields
  maxcpus?: number;
  level?: string;
  // Storage fields
  storage?: string;
  shared?: PveBool;
  content?: string;
  plugintype?: string;
  pool?: string;
}

/** Boolean-facing shape of ClusterResource — `template` and `shared`
 *  unwired from PveBool at the HTTP boundary. */
export type ClusterResourcePublic = UnwireBool<ClusterResource, 'template' | 'shared'>;

// ─── Nodes ────────────────────────────────────────────────────────────────────

export interface PVENode {
  node: string;
  status: 'online' | 'offline' | 'unknown';
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  level?: string;
  id?: string;
  type?: string;
}

export interface NodeStatus {
  node: string;
  status: string;
  cpu: number;
  cpuinfo: {
    cpus: number;
    cores: number;
    sockets: number;
    mhz: string;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
  };
  swap: {
    total: number;
    used: number;
    free: number;
  };
  rootfs: {
    total: number;
    used: number;
    free: number;
    avail: number;
  };
  uptime: number;
  kversion: string;
  pveversion: string;
  loadavg: [string, string, string];
  ksm?: { shared: number };
  time?: number;
}

// ─── VMs ──────────────────────────────────────────────────────────────────────

export type VMStatus = 'running' | 'stopped' | 'paused' | 'suspended';

export interface PVEVM {
  vmid: number;
  name?: string;
  status: VMStatus;
  cpu?: number;
  cpus?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  node?: string;
  template?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  pid?: number;
  qmpstatus?: string;
  tags?: string;
  lock?: string;
}

export interface VMConfig {
  name?: string;
  cores?: number;
  sockets?: number;
  cpu?: string;
  memory?: number;
  balloon?: number;
  net0?: string;
  scsi0?: string;
  ide2?: string;
  boot?: string;
  ostype?: string;
  agent?: string;
  onboot?: PveBool;
  protection?: PveBool;
  template?: PveBool;
  tags?: string;
  description?: string;
}

// ─── LXC Containers ───────────────────────────────────────────────────────────

export interface PVECT {
  vmid: number;
  name?: string;
  status: VMStatus;
  cpu?: number;
  cpus?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  node?: string;
  template?: number;
  netin?: number;
  netout?: number;
  type?: string;
  tags?: string;
  lock?: string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface PVEStorage {
  storage: string;
  type: string;
  content?: string;
  shared?: PveBool;
  active?: PveBool;
  enabled?: PveBool;
  total?: number;
  used?: number;
  avail?: number;
  used_fraction?: number;
}

/** Boolean-facing shape of PVEStorage (list row) — `shared`, `active`,
 *  `enabled` unwired from PveBool at the HTTP boundary. */
export type PVEStoragePublic = UnwireBool<PVEStorage, 'shared' | 'active' | 'enabled'>;

/** Subset of PVE storage backends exposed by Nexus's Map Storage flow. */
export type StorageBackendType = 'nfs' | 'cifs' | 'dir';

/**
 * Body for `POST /api2/json/storage` (cluster-wide storage pool creation).
 *
 * Field names mirror PVE's API exactly — `content` is a comma-separated
 * string (e.g. "iso,backup,images"), `nodes` is a comma-separated node
 * restriction (omit to enable on every node). `export` uses its reserved-
 * word spelling because that's the literal PVE parameter name. `mkdir`
 * is PVE's boolean-as-integer convention (0 = don't create subdirs, 1 = do).
 */
export interface StorageCreatePayload {
  storage: string;
  type: StorageBackendType;
  content?: string;
  nodes?: string;
  // NFS
  server?: string;
  export?: string;
  options?: string;
  // CIFS
  share?: string;
  username?: string;
  password?: string;
  smbversion?: string;
  // Directory
  path?: string;
  mkdir?: PveBool;
}

/** Body for `PUT /api2/json/storage/{id}`. PVE rejects attempts to change
 *  the ID or backend type once a pool exists, so both are stripped. */
export type StorageUpdatePayload = Partial<Omit<StorageCreatePayload, 'storage' | 'type'>>;

/** Response of `GET /api2/json/storage/{id}` — the full persisted config.
 *  Superset of `StorageCreatePayload` with PVE's optimistic-concurrency
 *  `digest` so callers can round-trip edits without races. */
export interface PVEStorageConfig extends StorageCreatePayload {
  digest?: string;
}

/** Boolean-facing shape of StorageCreatePayload. `mkdir` is unwired from
 *  PveBool; the client encodes it at the HTTP boundary. */
export type StorageCreatePayloadPublic = UnwireBool<StorageCreatePayload, 'mkdir'>;

/** Boolean-facing shape of StorageUpdatePayload (partial of the Public body). */
export type StorageUpdatePayloadPublic = Partial<
  Omit<StorageCreatePayloadPublic, 'storage' | 'type'>
>;

/** Boolean-facing shape of PVEStorageConfig (read path). */
export type PVEStorageConfigPublic = UnwireBool<PVEStorageConfig, 'mkdir'>;

// ─── Physical Disks (S.M.A.R.T.) ─────────────────────────────────────────────

/** Coarse PVE disk-type classification. */
export type DiskKind = 'hdd' | 'ssd' | 'usb' | 'nvme' | 'unknown';

/** Overall S.M.A.R.T. verdict from `smartctl -H`. PVE normalises this to
 *  one of three uppercase strings; any other value is treated as UNKNOWN. */
export type SmartHealth = 'PASSED' | 'FAILED' | 'UNKNOWN';

/** Row shape returned by GET /nodes/{node}/disks/list. Field set follows
 *  pve-storage Diskmanage.pm — most are optional because PVE omits them
 *  when they're not applicable to the underlying device. */
export interface DiskListEntry {
  devpath: string;
  size: number;
  model?: string;
  serial?: string;
  vendor?: string;
  type: DiskKind;
  /** SSD wear-leveling indicator: 0–100 (% remaining) or "N/A" string. */
  wearout?: number | string;
  /** Top-level S.M.A.R.T. health surfaced in the listing for quick badges. */
  health?: SmartHealth;
  wwn?: string;
  rpm?: number;
  by_id_link?: string;
  /** What's currently using the disk: 'ZFS' | 'LVM' | 'partitions' | 'mounted' | etc.
   *  Empty string when the disk is unused/free. */
  used?: string;
  /** 1 if the disk has a GPT partition table. */
  gpt?: PveBool;
  /** Ceph OSD id; -1 (or omitted) when not part of a Ceph cluster. */
  osdid?: number;
  parttype?: string;
}

/** Boolean-facing shape of DiskListEntry. `gpt` is unwired from PveBool at
 *  the HTTP boundary. */
export type DiskListEntryPublic = UnwireBool<DiskListEntry, 'gpt'>;

/** One row from `smartctl -A` (ATA) or the NVMe SMART/Health Information log.
 *  ATA reports populate id/value/worst/threshold/raw; NVMe reports tend to
 *  populate name/value only. All numeric fields are optional so the same
 *  type carries both shapes without lossy coercion. */
export interface SmartAttribute {
  /** ATA attribute id (1..255); absent on NVMe. */
  id?: number;
  name: string;
  value?: number;
  worst?: number;
  threshold?: number;
  /** Vendor-specific raw counter — kept as string because it can be huge or
   *  contain hex digits / suffixes like "0h+0m+0.000s". */
  raw?: string;
  /** smartctl flags (e.g. "Pre-fail  Always       -"). */
  flags?: string;
}

/** GET /nodes/{node}/disks/smart?disk={device} response. PVE either returns
 *  structured ATA/NVMe attributes or, for unrecognised report formats, a
 *  raw text dump in `text`. */
export interface SmartData {
  type: 'ata' | 'nvme' | 'text';
  health: SmartHealth;
  attributes?: SmartAttribute[];
  /** Raw smartctl output — populated only when type='text'. */
  text?: string;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'running' | 'stopped' | 'OK' | 'error';

export interface PVETask {
  upid: string;
  node: string;
  pid?: number;
  pstart?: number;
  starttime: number;
  endtime?: number;
  type: string;
  id?: string;
  user: string;
  status?: string;
  exitstatus?: string;
}

// ─── Console ──────────────────────────────────────────────────────────────────

export interface VNCProxyResponse {
  ticket: string;
  port: string;
  upid?: string;
  cert?: string;
  user?: string;
}

// ─── Network ──────────────────────────────────────────────────────────────────

export interface NodeRRDData {
  time: number;
  cpu?: number;
  memused?: number;
  memtotal?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  loadavg?: number;
}

/**
 * Per-storage RRD sample from `/nodes/{node}/storage/{storage}/rrddata`.
 * PVE consolidates over timeframe (hour/day/week/month, ~70 points each);
 * we use the `used` series to project exhaustion.
 */
export interface StorageRRDData {
  time: number;
  used?: number;
  total?: number;
  avail?: number;
}

// ─── Community Scripts ────────────────────────────────────────────────────────

/**
 * One note attached to a script. Upstream PocketBase records carry severity
 * (`info | warning | danger`), which the UI renders as colour-coded callouts.
 */
export interface ScriptNote {
  text: string;
  type: 'info' | 'warning' | 'danger';
}

/**
 * One install method variant declared by a script. Most LXC scripts ship a
 * `default` (Debian) method plus an `alpine` variant with lower resource
 * requirements; VM / misc scripts usually only declare `default`.
 */
export interface InstallMethod {
  /** Method key — `default`, `alpine`, etc. Upstream doesn't enum-constrain it. */
  type: string;
  /** Minimum resources the method needs. */
  resources: {
    cpu: number;
    /** RAM in MB. */
    ram: number;
    /** Disk in GB. */
    hdd: number;
    os: string;
    version: string;
  };
  /** Relative script path inside the ProxmoxVE repo (e.g. "ct/alpine-adguard.sh"). */
  scriptPath?: string;
  /** Full raw.githubusercontent URL to the install script for this method. */
  scriptUrl?: string;
  /** Path to the service's config file on the installed host. */
  config_path?: string | null;
}

export interface CommunityScript {
  name: string;
  slug: string;
  description: string;
  /** Primary category — for backward compat with list/filter UIs. */
  category: string;
  /** Full category set (a script can belong to several). */
  categories?: string[];
  /** Our canonical type. `ct` is the display name for an LXC container. */
  type: 'ct' | 'vm' | 'misc' | 'addon';
  author?: string;
  tags?: string[];
  /** Default-method raw.githubusercontent URL, wired into the Run button. */
  scriptUrl: string;
  jsonUrl?: string;
  nsapp?: string;
  date_created?: string;
  method?: string;
  /** Logo URL (selfhst/icons on jsDelivr, typically). */
  logo?: string;
  /** Web-interface port, when the installed service exposes one. */
  port?: number | null;
  updateable?: boolean;
  privileged?: boolean;
  has_arm?: boolean;
  /** Upstream project homepage. */
  website?: string | null;
  /** Upstream project documentation URL. */
  documentation?: string | null;
  /** GitHub owner/repo of the upstream project (not the script itself). */
  github?: string | null;
  /** All install method variants the script supports. */
  install_methods?: InstallMethod[];
  /** Where the bootstrap script is expected to run (`pve`, `lxc`, ...). */
  execute_in?: string[];
  default_credentials?: {
    username?: string;
    password?: string;
  };
  /**
   * Severity-tagged notes. (Was `string[]` pre-PocketBase; consumers that
   * only need the text should read `n.text`.)
   */
  notes?: ScriptNote[];
  /** Convenience snapshot of the default install method's resource needs. */
  resources?: {
    cpu?: number;
    ram?: number;
    hdd?: string;
    os?: string;
    version?: string;
  };
}

export interface ScriptExecutionPayload {
  node: string;
  storage: string;
  scriptUrl: string;
  scriptName: string;
}

// ─── CT Config ────────────────────────────────────────────────────────────────

export interface CTConfig {
  hostname?: string;
  cores?: number;
  memory?: number;
  swap?: number;
  rootfs?: string;
  net0?: string;
  net1?: string;
  net2?: string;
  net3?: string;
  ostype?: string;
  arch?: string;
  description?: string;
  tags?: string;
  onboot?: PveBool;
  protection?: PveBool;
  template?: PveBool;
  startup?: string;
  unprivileged?: number;
  features?: string;
  nameserver?: string;
  searchdomain?: string;
  mp0?: string;
  mp1?: string;
  lxc?: [string, string][];
}

// ─── Full VM Config (extends VMConfig with all disk/net slots) ────────────────

export interface VMConfigFull extends VMConfig {
  vmid?: number;
  cores?: number;
  sockets?: number;
  cpu?: string;
  memory?: number;
  balloon?: number;
  bios?: string;
  machine?: string;
  ostype?: string;
  agent?: string;
  onboot?: PveBool;
  protection?: PveBool;
  template?: PveBool;
  description?: string;
  tags?: string;
  boot?: string;
  bootdisk?: string;
  // disks
  scsi0?: string; scsi1?: string; scsi2?: string; scsi3?: string;
  scsi4?: string; scsi5?: string; scsi6?: string; scsi7?: string;
  ide0?: string; ide1?: string; ide2?: string; ide3?: string;
  sata0?: string; sata1?: string; sata2?: string;
  virtio0?: string; virtio1?: string;
  efidisk0?: string;
  // nics
  net0?: string; net1?: string; net2?: string; net3?: string;
  // cloud-init
  ciuser?: string;
  cipassword?: string;
  ipconfig0?: string;
  ipconfig1?: string;
  sshkeys?: string;
  searchdomain?: string;
  nameserver?: string;
  // usb/serial
  usb0?: string; serial0?: string;
  // meta
  lock?: string;
  digest?: string;
}

// ─── Storage Content ──────────────────────────────────────────────────────────

export interface StorageContent {
  volid: string;
  content: string;
  format?: string;
  size?: number;
  vmid?: number;
  name?: string;
  ctime?: number;
}

// ─── Node Network ─────────────────────────────────────────────────────────────

/** @deprecated Use NetworkIface */
export type NodeNetwork = NetworkIface;

// ─── Create / Clone / Migrate params ─────────────────────────────────────────

export interface CreateVMParams {
  vmid: number;
  name: string;
  node: string;
  cores: number;
  sockets: number;
  cpu?: string;
  memory: number;
  net0: string;
  scsi0?: string;
  ide2?: string;
  ostype?: string;
  bios?: string;
  agent?: number;
  onboot?: number;
  pool?: string;
  storage?: string;
  [key: string]: unknown;
}

export interface CreateCTParams {
  vmid: number;
  hostname: string;
  node: string;
  ostemplate: string;
  password: string;
  cores: number;
  memory: number;
  swap: number;
  rootfs: string;
  net0: string;
  unprivileged: PveBool;
  nameserver?: string;
  onboot?: number;
  pool?: string;
  storage?: string;
  [key: string]: unknown;
}

export interface CloneVMParams {
  newid: number;
  name?: string;
  target?: string;
  full?: PveBool;
  pool?: string;
  [key: string]: unknown;
}

export interface CloneCTParams {
  newid: number;
  hostname?: string;
  pool?: string;
  [key: string]: unknown;
}

export interface MigrateVMParams {
  target: string;
  online?: PveBool;
  with_local_disks?: PveBool;
  /** Bandwidth cap in KiB/s. 0 or omitted = unlimited. */
  bwlimit?: number;
  /** Dedicated migration network CIDR. Overrides cluster default. */
  migration_network?: string;
  /** Map local disk storage on the target — PVE accepts either a single
   *  storage name (applies to all) or the `<from>:<to>` form per-disk. */
  targetstorage?: string;
  /** Force migration even when PVE's precondition check would reject. */
  force?: PveBool;
  [key: string]: unknown;
}

export interface MigrateCTParams {
  target: string;
  restart?: PveBool;
  online?: PveBool;
  /** Bandwidth cap in KiB/s. */
  bwlimit?: number;
  /** Restart timeout in seconds — only meaningful with `restart: true`. */
  timeout?: number;
  [key: string]: unknown;
}

/**
 * Shape returned by PVE's migration-precondition endpoints:
 *   GET /nodes/{node}/qemu/{vmid}/migrate
 *   GET /nodes/{node}/lxc/{vmid}/migrate
 *
 * Each field may be absent on minor PVE versions; the wizard treats
 * missing arrays as "no information" (allow every online cluster node).
 */
export interface MigratePrecondition {
  running?: boolean;
  allowed_nodes?: string[];
  not_allowed_nodes?: Array<{ node?: string; reason?: string }>;
  local_disks?: Array<{ volid?: string; referenced_in_config?: string | number }>;
  local_resources?: string[];
}

export interface UpdateVMConfigParams {
  cores?: number;
  sockets?: number;
  memory?: number;
  balloon?: number;
  name?: string;
  description?: string;
  onboot?: PveBool;
  protection?: PveBool;
  template?: PveBool;
  agent?: string;
  tags?: string;
  boot?: string;
  cpu?: string;
  bios?: string;
  machine?: string;
  // ── Cloud-init params (applied post-clone by the builder wizard). All
  //    optional. PVE accepts them as VM config fields even though they're
  //    only meaningful when a cloud-init drive is attached to the VM.
  /** Default user (e.g., "ubuntu"). */
  ciuser?: string;
  /** Plaintext or crypted password. PVE hashes server-side; do NOT pre-hash. */
  cipassword?: string;
  /** Multi-line OpenSSH keys, one per line. encodeUpdateVMConfig URL-encodes
   *  newlines to %0A — callers pass literal newlines. */
  sshkeys?: string;
  /** Per-NIC config string, e.g. "ip=dhcp" or "ip=10.0.0.5/24,gw=10.0.0.1". */
  ipconfig0?: string;
  ipconfig1?: string;
  ipconfig2?: string;
  ipconfig3?: string;
  /** Space-separated DNS search domain list. */
  searchdomain?: string;
  /** Space-separated DNS server list (IPv4 and/or IPv6). */
  nameserver?: string;
  /** Cloud-init backend variant — rarely needed; default (nocloud) is fine. */
  citype?: 'nocloud' | 'configdrive2';
  /** Reference to an advanced user-data file in a snippets: storage
   *  (format: "user=<storage>:<path>"). Out of v1 UI scope but typed so
   *  future editors can expose it without another type migration. */
  cicustom?: string;
  [key: string]: unknown;
}

export interface UpdateCTConfigParams {
  hostname?: string;
  cores?: number;
  memory?: number;
  swap?: number;
  description?: string;
  onboot?: PveBool;
  protection?: PveBool;
  template?: PveBool;
  tags?: string;
  nameserver?: string;
  searchdomain?: string;
  [key: string]: unknown;
}

/** Boolean-facing shapes for the VM/CT boundary. `onboot`, `protection`,
 *  `template` on configs; `full` on CloneVM; `online` on both Migrates and
 *  `with_local_disks` on MigrateVM; `restart` on MigrateCT.
 *
 *  Note on semantics: unlike `PVEUser.enable` (which defaults to "enabled"
 *  when absent), these fields all default to *false* when absent in PVE's
 *  config schema. Read sites should use `?? false`, not `!== false`. */
export type VMConfigPublic = UnwireBool<VMConfig, 'onboot' | 'protection' | 'template'>;
export type VMConfigFullPublic = UnwireBool<VMConfigFull, 'onboot' | 'protection' | 'template'>;
export type CTConfigPublic = UnwireBool<CTConfig, 'onboot' | 'protection' | 'template'>;
export type UpdateVMConfigParamsPublic = UnwireBool<UpdateVMConfigParams, 'onboot' | 'protection' | 'template'>;
export type UpdateCTConfigParamsPublic = UnwireBool<UpdateCTConfigParams, 'onboot' | 'protection' | 'template'>;
export type CloneVMParamsPublic = UnwireBool<CloneVMParams, 'full'>;
export type MigrateVMParamsPublic = UnwireBool<MigrateVMParams, 'online' | 'with_local_disks'>;
export type MigrateCTParamsPublic = UnwireBool<MigrateCTParams, 'online' | 'restart'>;

// ─── Tier 4 — System ─────────────────────────────────────────────────────────

export type NodePowerCommand = 'reboot' | 'shutdown';

// From GET /nodes/{node}/apt/versions — installed PVE packages
export interface AptInstalledPackage {
  Package: string;
  Title: string;
  Version: string;
  OldVersion?: string;
  Origin?: string;
  Arch?: string;
  Description?: string;
  Section?: string;
  Priority?: string;
  CurrentState?: string;
  ManagerVersion?: string;
  NotifyStatus?: string;
  RunningVersion?: string;
  [key: string]: unknown;
}

// From GET /nodes/{node}/apt/update — upgradable packages
export interface AptUpdatablePackage {
  Package: string;
  Title: string;
  Version: string;       // new available version
  OldVersion: string;    // currently installed version
  Origin?: string;
  Arch?: string;
  Description?: string;
  Section?: string;
  Priority?: string;
  [key: string]: unknown;
}

/** @deprecated Use AptInstalledPackage or AptUpdatablePackage */
export type AptPackage = AptUpdatablePackage;

export interface NetworkIface {
  iface: string;
  type: string;
  active?: PveBool;
  autostart?: PveBool;
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
  autostart?: PveBool;
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

/** PVE /journal returns raw journalctl lines as strings. */
export type JournalEntry = string;

export interface JournalParams {
  lastentries?: number;
  since?: string;
  until?: string;
  [key: string]: unknown;
}

// ─── Tier 2 — Snapshots ──────────────────────────────────────────────────────

export interface PVESnapshot {
  name: string;
  description?: string;
  snaptime?: number;
  parent?: string;
  vmstate?: PveBool;
  running?: PveBool;
}

export interface CreateSnapshotParams {
  snapname: string;
  description?: string;
  vmstate?: PveBool;
  [key: string]: unknown;
}

// ─── Tier 2 — Backups ────────────────────────────────────────────────────────

export type BackupMode = 'snapshot' | 'suspend' | 'stop';
export type BackupCompress = '0' | '1' | 'gzip' | 'lzo' | 'zstd';

export interface BackupJob {
  id: string;
  schedule: string;
  enabled?: PveBool;
  all?: PveBool;
  vmid?: string;
  exclude?: string;
  pool?: string;
  node?: string;
  storage: string;
  mode: BackupMode;
  compress?: BackupCompress;
  mailto?: string;
  mailnotification?: 'always' | 'failure';
  'notes-template'?: string;
  comment?: string;
  starttime?: string;
  dow?: string;
  'prune-backups'?: string;
  remove?: PveBool;
  protected?: PveBool;
}

export interface BackupJobParams extends Partial<Omit<BackupJob, 'id'>> {
  [key: string]: unknown;
}

export interface BackupFile {
  volid: string;
  ctime: number;
  size: number;
  format?: string;
  vmid?: number;
  subtype?: 'qemu' | 'lxc';
  notes?: string;
  protected?: PveBool;
  verification?: {
    state: 'ok' | 'failed' | 'none';
    upid?: string;
  };
  encrypted?: string;
}

export interface VzdumpParams {
  vmid?: number | string;
  all?: PveBool;
  node?: string;
  storage: string;
  mode?: BackupMode;
  compress?: BackupCompress;
  notes?: string;
  protected?: PveBool;
  remove?: PveBool;
  'notes-template'?: string;
  [key: string]: unknown;
}

export interface RestoreParams {
  vmid: number;
  archive: string;
  storage?: string;
  force?: PveBool;
  unique?: PveBool;
  pool?: string;
  start?: PveBool;
  [key: string]: unknown;
}

/** Boolean-facing shape of RestoreParams. `force` / `unique` / `start` are
 *  unwired from PveBool at the HTTP boundary. */
export type RestoreParamsPublic = UnwireBool<RestoreParams, 'force' | 'unique' | 'start'>;

// ─── Tier 2 — Storage content / upload ───────────────────────────────────────

export type StorageContentType = 'iso' | 'vztmpl' | 'backup' | 'images' | 'rootdir' | 'snippets';

export interface IsoUploadParams {
  node: string;
  storage: string;
  content: 'iso' | 'vztmpl';
  filename: string;
  file: File;
}

export interface DownloadUrlParams {
  node: string;
  storage: string;
  content: 'iso' | 'vztmpl';
  url: string;
  filename: string;
  checksum?: string;
  'checksum-algorithm'?: 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
  [key: string]: unknown;
}

// ─── Tier 3 — Firewall ───────────────────────────────────────────────────────

export type FirewallRuleType = 'in' | 'out' | 'group';

export interface FirewallRule {
  pos: number;
  type: FirewallRuleType;
  action: string;
  enable?: PveBool;
  macro?: string;
  source?: string;
  dest?: string;
  proto?: string;
  sport?: string;
  dport?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  comment?: string;
  ipversion?: 4 | 6;
  'icmp-type'?: string;
  digest?: string;
}

export interface FirewallRuleParams extends Partial<Omit<FirewallRule, 'pos'>> {
  [key: string]: unknown;
}

export interface FirewallAlias {
  name: string;
  cidr: string;
  comment?: string;
  ipversion?: 4 | 6;
  digest?: string;
}

export interface FirewallIPSet {
  name: string;
  comment?: string;
  digest?: string;
}

export interface FirewallIPSetEntry {
  cidr: string;
  comment?: string;
  nomatch?: PveBool;
  digest?: string;
}

export interface FirewallGroup {
  group: string;
  comment?: string;
  digest?: string;
}

export interface FirewallOptions {
  enable?: PveBool;
  log_level_in?: string;
  log_level_out?: string;
  policy_in?: 'ACCEPT' | 'DROP' | 'REJECT';
  policy_out?: 'ACCEPT' | 'DROP' | 'REJECT';
  ebtables?: PveBool;
  nosmurfs?: PveBool;
  tcpflags?: PveBool;
  macfilter?: PveBool;
  // VM-specific
  dhcp?: PveBool;
  ipfilter?: PveBool;
  ndp?: PveBool;
  radv?: PveBool;
  digest?: string;
  [key: string]: unknown;
}

/** Public-facing shape of FirewallOptions with boolean flags unwired from
 *  PveBool. The API client's firewall methods translate to/from the wire
 *  shape at the HTTP boundary. */
export type FirewallOptionsPublic = UnwireBool<
  FirewallOptions,
  | 'enable'
  | 'ebtables'
  | 'nosmurfs'
  | 'tcpflags'
  | 'macfilter'
  | 'dhcp'
  | 'ipfilter'
  | 'ndp'
  | 'radv'
>;

// ─── Tier 3 — Access control ─────────────────────────────────────────────────

export interface PVEUser {
  userid: string;
  email?: string;
  enable?: PveBool;
  expire?: number;
  firstname?: string;
  lastname?: string;
  comment?: string;
  groups?: string;
  keys?: string;
  tokens?: unknown[];
  realm?: string;
}

export interface UserParams {
  userid: string;
  password?: string;
  email?: string;
  enable?: PveBool;
  expire?: number;
  firstname?: string;
  lastname?: string;
  comment?: string;
  groups?: string;
  keys?: string;
  [key: string]: unknown;
}

/** Boolean-facing shapes of the user types. `enable` is unwired at the
 *  HTTP boundary. Note PVE's convention: `enable === undefined` means
 *  "enabled" (field wasn't set, defaults to enabled). Consumers must
 *  distinguish that from an explicit `false`. */
export type PVEUserPublic = UnwireBool<PVEUser, 'enable'>;
export type UserParamsPublic = UnwireBool<UserParams, 'enable'>;

export interface PVEGroup {
  groupid: string;
  comment?: string;
  users?: string;
}

export interface GroupParams {
  groupid: string;
  comment?: string;
  [key: string]: unknown;
}

export interface PVERole {
  roleid: string;
  privs?: string;
  special?: PveBool;
}

export interface RoleParams {
  roleid: string;
  privs?: string;
  [key: string]: unknown;
}

/** Boolean-facing shape of PVERole — `special` (built-in indicator) is
 *  unwired at the HTTP boundary. */
export type PVERolePublic = UnwireBool<PVERole, 'special'>;

export type RealmType = 'pam' | 'pve' | 'ldap' | 'ad' | 'openid';

export interface PVERealm {
  realm: string;
  type: RealmType;
  comment?: string;
  default?: PveBool;
  tfa?: string;
  // LDAP/AD
  server1?: string;
  server2?: string;
  base_dn?: string;
  user_attr?: string;
  bind_dn?: string;
  secure?: PveBool;
  port?: number;
  // OpenID
  'issuer-url'?: string;
  'client-id'?: string;
  'client-key'?: string;
  autocreate?: PveBool;
  digest?: string;
  [key: string]: unknown;
}

export interface RealmParams extends Partial<PVERealm> {
  [key: string]: unknown;
}

/** Boolean-facing shapes of the realm types. `default`, `secure`, and
 *  `autocreate` are unwired at the HTTP boundary. */
export type PVERealmPublic = UnwireBool<PVERealm, 'default' | 'secure' | 'autocreate'>;
export type RealmParamsPublic = UnwireBool<RealmParams, 'default' | 'secure' | 'autocreate'>;

export interface PVEACL {
  path: string;
  type: 'user' | 'group' | 'token';
  ugid: string;
  roleid: string;
  propagate?: PveBool;
}

/** Boolean-facing shape of PVEACL — `propagate` unwired at the HTTP boundary. */
export type PVEACLPublic = UnwireBool<PVEACL, 'propagate'>;

export interface ACLParams {
  path: string;
  roles: string;
  users?: string;
  groups?: string;
  tokens?: string;
  propagate?: PveBool;
  delete?: PveBool;
  [key: string]: unknown;
}

/** Boolean-facing shape of ACLParams — `propagate` and `delete` are unwired
 *  at the HTTP boundary. */
export type ACLParamsPublic = UnwireBool<ACLParams, 'propagate' | 'delete'>;

// ─── Tier 3 — HA + Cluster ───────────────────────────────────────────────────

export type HAResourceType = 'vm' | 'ct';
export type HAState = 'started' | 'stopped' | 'enabled' | 'disabled' | 'ignored';

export interface HAResource {
  sid: string;
  type: HAResourceType;
  state: HAState;
  group?: string;
  max_restart?: number;
  max_relocate?: number;
  comment?: string;
  digest?: string;
}

export interface HAResourceParams {
  sid: string;
  type?: HAResourceType;
  state?: HAState;
  group?: string;
  max_restart?: number;
  max_relocate?: number;
  comment?: string;
  [key: string]: unknown;
}

export interface HAGroup {
  group: string;
  nodes: string;
  restricted?: PveBool;
  nofailback?: PveBool;
  comment?: string;
  type?: 'group';
  digest?: string;
}

export interface HAGroupParams {
  group: string;
  nodes: string;
  restricted?: PveBool;
  nofailback?: PveBool;
  comment?: string;
  [key: string]: unknown;
}

/** Boolean-facing shapes of the HA Group types. `restricted` and `nofailback`
 *  are unwired from PveBool at the HTTP boundary. */
export type HAGroupPublic = UnwireBool<HAGroup, 'restricted' | 'nofailback'>;
export type HAGroupParamsPublic = UnwireBool<HAGroupParams, 'restricted' | 'nofailback'>;

export interface HAStatus {
  id: string;
  sid?: string;
  state?: string;
  node?: string;
  crm_state?: string;
  request_state?: string;
  type: 'node' | 'service' | 'quorum' | 'master' | 'lrm';
  status?: string;
  quorate?: PveBool;
}

/** Boolean-facing shape of HAStatus — `quorate` unwired from PveBool. */
export type HAStatusPublic = UnwireBool<HAStatus, 'quorate'>;

export interface ClusterStatus {
  type: 'cluster' | 'node';
  name: string;
  id?: string;
  quorate?: PveBool;
  version?: number;
  nodes?: number;
  online?: PveBool;
  ip?: string;
  level?: string;
  local?: PveBool;
  nodeid?: number;
}

/** Boolean-facing shape of ClusterStatus. `quorate`, `online`, and `local`
 *  are unwired from PveBool at the HTTP boundary. */
export type ClusterStatusPublic = UnwireBool<ClusterStatus, 'quorate' | 'online' | 'local'>;

// ─── Tier 3 — Pools ──────────────────────────────────────────────────────────

export interface PVEPoolMember {
  id: string;
  type: 'qemu' | 'lxc' | 'storage';
  node?: string;
  storage?: string;
  vmid?: number;
  name?: string;
}

export interface PVEPool {
  poolid: string;
  comment?: string;
  members?: PVEPoolMember[];
}

export interface PoolParams {
  poolid: string;
  comment?: string;
  vms?: string;
  storage?: string;
  delete?: PveBool;
  [key: string]: unknown;
}

// ─── B6: Remaining domain Public variants ────────────────────────────────────

/** Backup domain. `BackupJob.enabled` defaults to enabled when absent (read
 *  with `!== false`); `BackupFile.protected`, `VzdumpParams.protected` etc.
 *  default to disabled (`?? false`). */
export type BackupJobPublic = UnwireBool<BackupJob, 'enabled' | 'all' | 'remove' | 'protected'>;
export type BackupJobParamsPublic = Partial<Omit<BackupJobPublic, 'id'>>;
export type BackupFilePublic = UnwireBool<BackupFile, 'protected'>;
export type VzdumpParamsPublic = UnwireBool<VzdumpParams, 'all' | 'protected' | 'remove'>;

/** Snapshot domain. Both `vmstate` and `running` default to disabled. */
export type PVESnapshotPublic = UnwireBool<PVESnapshot, 'vmstate' | 'running'>;
export type CreateSnapshotParamsPublic = UnwireBool<CreateSnapshotParams, 'vmstate'>;

/** Firewall rule / IPSet entry. `enable` defaults to enabled; `nomatch`
 *  defaults to disabled. */
export type FirewallRulePublic = UnwireBool<FirewallRule, 'enable'>;
export type FirewallRuleParamsPublic = Partial<Omit<FirewallRulePublic, 'pos'>>;
export type FirewallIPSetEntryPublic = UnwireBool<FirewallIPSetEntry, 'nomatch'>;

/** CT creation. `unprivileged` defaults to false (i.e. privileged). */
export type CreateCTParamsPublic = UnwireBool<CreateCTParams, 'unprivileged'>;

/** Network interfaces. `autostart` defaults to enabled (`!== false`). */
export type NetworkIfacePublic = UnwireBool<NetworkIface, 'autostart' | 'active'>;
export type NetworkIfaceParamsPublic = UnwireBool<NetworkIfaceParams, 'autostart'>;

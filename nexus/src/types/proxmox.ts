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
}

// ─── Cluster ──────────────────────────────────────────────────────────────────

export type ResourceType = 'node' | 'vm' | 'lxc' | 'storage' | 'pool';

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
  template?: number;
  // Node fields
  maxcpus?: number;
  level?: string;
  // Storage fields
  storage?: string;
  shared?: number;
  content?: string;
  plugintype?: string;
  pool?: string;
}

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
  onboot?: number;
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
  shared?: number;
  active?: number;
  enabled?: number;
  total?: number;
  used?: number;
  avail?: number;
  used_fraction?: number;
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

// ─── Community Scripts ────────────────────────────────────────────────────────

export interface CommunityScript {
  name: string;
  slug: string;
  description: string;
  category: string;
  type: 'ct' | 'vm' | 'misc' | 'addon';
  author?: string;
  tags?: string[];
  scriptUrl: string;
  jsonUrl?: string;
  nsapp?: string;
  date_created?: string;
  method?: string;
  default_credentials?: {
    username?: string;
    password?: string;
  };
  notes?: string[];
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
  onboot?: number;
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
  onboot?: number;
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
  unprivileged: number;
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
  full?: number;
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
  online?: number;
  with_local_disks?: number;
  [key: string]: unknown;
}

export interface MigrateCTParams {
  target: string;
  restart?: number;
  online?: number;
  [key: string]: unknown;
}

export interface UpdateVMConfigParams {
  cores?: number;
  sockets?: number;
  memory?: number;
  balloon?: number;
  name?: string;
  description?: string;
  onboot?: number;
  agent?: string;
  tags?: string;
  boot?: string;
  cpu?: string;
  bios?: string;
  machine?: string;
  [key: string]: unknown;
}

export interface UpdateCTConfigParams {
  hostname?: string;
  cores?: number;
  memory?: number;
  swap?: number;
  description?: string;
  onboot?: number;
  tags?: string;
  nameserver?: string;
  searchdomain?: string;
  [key: string]: unknown;
}

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

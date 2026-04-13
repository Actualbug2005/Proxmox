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

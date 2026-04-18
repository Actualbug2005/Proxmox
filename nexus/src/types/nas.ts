/**
 * NAS data contracts — Phase 2 provider-pattern scaffolding.
 *
 * Two backends will implement `NasProvider`:
 *   • unasProvider   — talks to U-NAS's REST API over HTTP.
 *   • nativeProvider — shells out to the PVE host's Samba + NFS-kernel-server.
 *
 * The UI and the API layer import ONLY this module and the registry — never a
 * specific provider — so swapping backends never touches dashboard code.
 */

export type NasProtocol = 'smb' | 'nfs';

/**
 * Share status.
 *
 *   active   — exported by a running daemon (smbd / nfs-kernel-server).
 *   inactive — export is configured but the daemon isn't running right now.
 *   error    — daemon refused the export (bad perms, invalid config).
 *   orphan   — config references this share but the NAS daemon isn't even
 *              installed on the node, or the export path doesn't exist on
 *              disk. These are leftovers — the UI offers deletion.
 */
export type NasShareStatus = 'active' | 'inactive' | 'error' | 'orphan';

export interface NasShare {
  /** Stable id chosen by the backing provider (path, UUID, index, …). */
  id: string;
  /** Human-facing share name — the SMB share name or the NFS export label. */
  name: string;
  /** Absolute filesystem path the share exports. */
  path: string;
  /** Which protocols currently expose this path. */
  protocols: NasProtocol[];
  /** Runtime health. 'error' means the daemon refused the export (bad perms,
   *  missing path, config invalid, etc.). */
  status: NasShareStatus;
  /** Present when `status === 'error'` — human-readable reason the daemon
   *  refused the export. Surfaced in the UI so operators don't need to
   *  shell into the node to diagnose a broken share. Providers may leave
   *  it undefined if the specific reason is unknowable from their API. */
  errorReason?: string;
  /** True when the export is read-only. */
  readOnly: boolean;
}

/** Input shape for createShare — the provider assigns id + initial status. */
export type CreateNasSharePayload = Omit<NasShare, 'id' | 'status'>;

/**
 * Daemon status. `not-installed` distinguishes "the systemd unit doesn't
 * exist on this host" from "the unit exists but is inactive" — the
 * first is an actionable setup hint ("apt install samba"), the second
 * is a routine start/stop toggle.
 */
export type NasServiceStatus = 'running' | 'stopped' | 'not-installed';

export interface NasService {
  protocol: NasProtocol;
  status: NasServiceStatus;
  /** Daemon version string if the provider can surface it. */
  version?: string;
  /**
   * The systemd unit the probe matched (e.g. `smbd.service`,
   * `smbd.socket`, `smb.service`). Helpful for operators who run a
   * non-default distro; absent when status === 'not-installed'.
   */
  unit?: string;
}

/**
 * One mount the PVE host is consuming as a client — e.g. a CIFS export
 * from a separate NAS, an NFS share from another server. Distinct from
 * NasShare (which represents shares this host EXPORTS).
 *
 * Used for the "Connected mounts" card on the NAS tab so an operator
 * can see at a glance "this PVE box gets its bulk storage from
 * 10.2.1.122 over CIFS".
 */
export interface NasClientMount {
  /** Source descriptor as reported by the kernel mount table — e.g.
   *  `//10.2.1.122/Share` for CIFS, `nas01:/exports/data` for NFS. */
  source: string;
  /** Local mountpoint, e.g. `/mnt/the_singularity`. */
  mountpoint: string;
  /** Filesystem type — `cifs` or `nfs` / `nfs4`. */
  fsType: 'cifs' | 'nfs' | 'nfs4';
  /** Server address parsed out of `source` for at-a-glance grouping. */
  server: string;
  /** Share / export name parsed out of `source`. */
  shareName: string;
  /** True if mounted read-only. */
  readOnly: boolean;
}

/**
 * One directory entry returned by the read-only file browser.
 *
 * `relativePath` is the path-from-share-root that the client feeds back
 * into listDirectory's subPath to drill into a subdirectory (or, later,
 * into a download endpoint). Caller composes `currentPath + '/' + name`
 * server-side so the client can trust what comes back without rebuilding
 * the string (and accidentally traversing).
 */
export interface FileNode {
  name: string;
  type: 'file' | 'dir' | 'symlink';
  size: number;
  /** Unix modification time in seconds since epoch (float — GNU find's %T@). */
  mtime: number;
  relativePath: string;
}

/**
 * Abstract backend contract. All methods are async because every
 * implementation does I/O (REST or SSH shell-out). The interface accepts an
 * explicit `node` on every call so a single provider instance can serve
 * multiple cluster members without per-node state.
 */
export interface NasProvider {
  getShares(node: string): Promise<NasShare[]>;
  createShare(node: string, payload: CreateNasSharePayload): Promise<NasShare>;
  deleteShare(node: string, id: string): Promise<void>;
  getServices(node: string): Promise<NasService[]>;
  /**
   * List one level of `shareId`'s content at `subPath`. `subPath` is always
   * relative to the share root — never an absolute path — and must not
   * contain '..'. The provider is responsible for verifying the resolved
   * target hasn't escaped the share boundary via symlinks.
   */
  listDirectory(node: string, shareId: string, subPath: string): Promise<FileNode[]>;

  /**
   * Stream the contents of a single regular file under `shareId`.
   *
   * Promise resolves once the provider has enough information to return a
   * valid HTTP response — specifically once the file size is known — but
   * before any body bytes are pulled. The returned `stream` is a Web
   * ReadableStream the caller hands to `new Response(...)`.
   */
  downloadFile(
    node: string,
    shareId: string,
    subPath: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; filename: string; size: number }>;

  /**
   * Write a new file under `shareId/subDir` with the given contents.
   * `subDir` is relative to the share root and MUST NOT contain `..`.
   * `filename` must be a plain basename (no slashes). The provider is
   * responsible for refusing overwrites and for atomically renaming a
   * tmp file into place so readers never see a partial write.
   *
   * Size-capped by the provider to protect against DoS on shared
   * infrastructure. Native caps at 100 MB in the first cut.
   */
  uploadFile(
    node: string,
    shareId: string,
    subDir: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<void>;

  /**
   * Enumerate CIFS / NFS mounts this node is consuming as a client.
   * Optional — providers that have no kernel mount table to inspect
   * (e.g. U-NAS REST adapter) may omit this and the UI hides the
   * "Connected mounts" card.
   */
  getClientMounts?(node: string): Promise<NasClientMount[]>;

  /**
   * Read the current user + group quotas for a share's filesystem.
   * Returns `null` if the share's filesystem doesn't have quotas enabled
   * (the UI shows an actionable hint instead of a crash).
   */
  getQuotas?(node: string, shareId: string): Promise<QuotaReport | null>;

  /**
   * Set a soft + hard block quota for one user or group on the share's
   * filesystem. Sizes are bytes; pass 0 to clear the quota.
   */
  setQuota?(
    node: string,
    shareId: string,
    target: QuotaTarget,
    softBytes: number,
    hardBytes: number,
  ): Promise<void>;
}

// ─── Quotas (7.x backlog item B) ────────────────────────────────────────────

/** Scope of one quota row — either a UNIX user or a UNIX group. */
export interface QuotaTarget {
  kind: 'user' | 'group';
  /** Textual username or groupname. Lookup + conversion to UID/GID
   *  happens inside the provider (so an operator can type `apache`, not
   *  `33`). */
  name: string;
}

/** One quota row as returned by `repquota -u` / `-g`. */
export interface QuotaEntry {
  kind: 'user' | 'group';
  name: string;
  /** Current block usage in bytes. */
  usedBytes: number;
  /** Soft limit in bytes. 0 = no limit. */
  softBytes: number;
  /** Hard limit in bytes. 0 = no limit. */
  hardBytes: number;
}

export interface QuotaReport {
  /** Filesystem device the quotas live on (e.g. `/dev/sda1`). */
  device: string;
  users: QuotaEntry[];
  groups: QuotaEntry[];
}

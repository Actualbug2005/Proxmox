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

export type NasShareStatus = 'active' | 'inactive' | 'error';

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
  /** True when the export is read-only. */
  readOnly: boolean;
}

/** Input shape for createShare — the provider assigns id + initial status. */
export type CreateNasSharePayload = Omit<NasShare, 'id' | 'status'>;

export interface NasService {
  protocol: NasProtocol;
  status: 'running' | 'stopped';
  /** Daemon version string if the provider can surface it. */
  version?: string;
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
}

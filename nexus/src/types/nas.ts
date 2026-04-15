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
}

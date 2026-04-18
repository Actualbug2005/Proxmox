/**
 * Guest-agent probe types (5.2).
 *
 * We only target QEMU guests whose `agent=1` flag is set in the VM config;
 * LXC containers don't have a qemu-guest-agent equivalent and are deferred
 * to a later phase.
 *
 * The probe surface is deliberately narrow: filesystem pressure + agent
 * liveness. Anything richer (process table, network sockets, service
 * health) is out of scope for the first cut.
 */

/** One mountpoint as reported by qemu-guest-agent's `guest-get-fsinfo`. */
export interface GuestFilesystem {
  /** Mountpoint path inside the guest, e.g. `/`, `/var/log`, `C:\`. */
  mountpoint: string;
  /** Filesystem type (ext4, xfs, ntfs, …). Purely informational. */
  type: string;
  /** Total size in bytes. */
  totalBytes: number;
  /** Used in bytes. */
  usedBytes: number;
}

/** Live probe result for a single guest. */
export interface GuestProbe {
  vmid: number;
  node: string;
  /** Reachable means QMP agent ping succeeded this call. */
  reachable: boolean;
  /** Present when `reachable=false`; short reason for UI + logging. */
  reason?: string;
  /** Present when `reachable=true`. May be empty array for minimal images. */
  filesystems?: GuestFilesystem[];
}

/** Disk-pressure observation — a mountpoint above threshold. */
export interface DiskPressure {
  vmid: number;
  node: string;
  mountpoint: string;
  usedPct: number;
  totalBytes: number;
  usedBytes: number;
}

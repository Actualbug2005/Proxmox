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
  /**
   * Failed systemd units from this probe cycle. Only populated on ticks where
   * the services probe ran (1/3 cadence). Undefined on off-ticks; empty
   * array means "probe ran and found zero failed units".
   */
  failedServices?: GuestFailedService[];
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

/**
 * One failed systemd unit reported by `systemctl list-units --state=failed`.
 * `description` is the human-readable text; `since` is walltime (ms epoch)
 * when the unit was first observed in the failed set this run.
 */
export interface GuestFailedService {
  unit: string;
  description: string;
  since: number;
}


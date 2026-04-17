/**
 * PVE role-gating helper.
 *
 * Queries GET /access/permissions?path=<path>&userid=<user> using the
 * session's PVE ticket and checks whether the caller holds a required
 * privilege bit on the target path. Used to keep shell-execution and
 * script-run endpoints behind Sys.Modify on the target node.
 */
import type { PVEAuthSession } from '@/types/proxmox';
import { pveFetch } from '@/lib/pve-fetch';

type PermissionsResponse = { data?: Record<string, Record<string, number>> };

/**
 * Returns true only if PVE explicitly grants the privilege. Fails CLOSED on:
 *  - HTTP non-2xx (invalid ticket, 403, 500, etc.)
 *  - Transport errors (DNS, TLS handshake, connection refused, abort)
 *  - Malformed response bodies
 *
 * The outer try/catch is load-bearing: if anyone later wraps this function
 * with `.catch(() => true)` for "resilience", they can still exploit it,
 * but at least nothing this function does will throw into the caller's
 * catch block and silently fail open.
 */
export async function userHasPrivilege(
  session: PVEAuthSession,
  path: string,
  privilege: string,
): Promise<boolean> {
  const qs = new URLSearchParams({ path, userid: session.username }).toString();
  const url = `https://${session.proxmoxHost}:8006/api2/json/access/permissions?${qs}`;

  try {
    const res = await pveFetch(url, {
      headers: { Cookie: `PVEAuthCookie=${session.ticket}` },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as PermissionsResponse;
    const entry = body.data?.[path];
    return Boolean(entry && entry[privilege]);
  } catch (err) {
    console.error('[userHasPrivilege] transport error:', err);
    return false;
  }
}

export async function requireNodeSysModify(
  session: PVEAuthSession,
  node: string,
): Promise<boolean> {
  return userHasPrivilege(session, `/nodes/${node}`, 'Sys.Modify');
}

/**
 * Sys.Audit allows read-only inspection of node state. Used for endpoints
 * that surface diagnostics (process listings, service status) without
 * exposing arbitrary shell execution. Sys.Modify implicitly satisfies
 * Sys.Audit per PVE's privilege model — we check both so an admin without
 * an explicit Sys.Audit grant still passes.
 */
export async function requireNodeSysAudit(
  session: PVEAuthSession,
  node: string,
): Promise<boolean> {
  if (await userHasPrivilege(session, `/nodes/${node}`, 'Sys.Audit')) return true;
  return userHasPrivilege(session, `/nodes/${node}`, 'Sys.Modify');
}

/**
 * VM.Migrate on /vms/{vmid} is the PVE privilege that gates live + offline
 * migration of both QEMU VMs and LXC CTs (they share the /vms/ ACL path).
 * Root@pam satisfies this implicitly; other users need the explicit grant.
 */
export async function requireVmMigrate(
  session: PVEAuthSession,
  vmid: number,
): Promise<boolean> {
  return userHasPrivilege(session, `/vms/${vmid}`, 'VM.Migrate');
}

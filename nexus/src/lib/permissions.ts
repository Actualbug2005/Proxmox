/**
 * PVE role-gating helper.
 *
 * Queries GET /access/permissions?path=<path>&userid=<user> using the
 * session's PVE ticket and checks whether the caller holds a required
 * privilege bit on the target path. Used to keep shell-execution and
 * script-run endpoints behind Sys.Modify on the target node.
 */
import type { PVEAuthSession } from '@/types/proxmox';

type PermissionsResponse = { data?: Record<string, Record<string, number>> };

export async function userHasPrivilege(
  session: PVEAuthSession,
  path: string,
  privilege: string,
): Promise<boolean> {
  const qs = new URLSearchParams({ path, userid: session.username }).toString();
  const url = `https://${session.proxmoxHost}:8006/api2/json/access/permissions?${qs}`;

  const res = await fetch(url, {
    headers: { Cookie: `PVEAuthCookie=${session.ticket}` },
  });
  if (!res.ok) return false;

  const body = (await res.json()) as PermissionsResponse;
  const entry = body.data?.[path];
  return Boolean(entry && entry[privilege]);
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

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
// Relative + explicit `.ts`: see exec-audit.ts for the full rationale
// (Node's --experimental-strip-types loader in server.ts has no
// path-alias resolver; only webpack does).
import { emit as emitNotification } from './notifications/event-bus.ts';

type PermissionsResponse = { data?: Record<string, Record<string, number>> };

/**
 * Probe-error observability counter. The probe can fail for reasons that
 * are NOT a genuine permission denial — upstream 5xx, transport error,
 * malformed JSON. Each of those collapses to `false` (fail-closed, see
 * userHasPrivilege JSDoc) so callers can't tell them apart from a real
 * denial. The counter + structured log line let ops spot a broken PVE
 * without scanning every call site. Phase C's /api/system/health exposes
 * the count. Lives on globalThis so HMR doesn't reset it in dev.
 */
declare global {
   
  var __nexusPermissionProbeErrors: number | undefined;
}
type ProbeErrorKind = 'http_5xx' | 'transport' | 'parse';
function logProbeError(
  kind: ProbeErrorKind,
  path: string,
  user: string,
  extra: string,
): void {
  globalThis.__nexusPermissionProbeErrors = (globalThis.__nexusPermissionProbeErrors ?? 0) + 1;
  console.error(
    '[nexus event=permission_probe_error] kind=%s user=%s path=%s %s',
    kind,
    user,
    path,
    extra,
  );
  emitNotification({
    kind: 'permission.probe.error',
    at: Date.now(),
    payload: { probeKind: kind, username: user, path, extra },
  });
}
export function getPermissionProbeErrorCount(): number {
  return globalThis.__nexusPermissionProbeErrors ?? 0;
}

/**
 * Returns true only if PVE explicitly grants the privilege. Fails CLOSED on:
 *  - HTTP 401/403/404 (legitimate denial — not logged as a probe error)
 *  - HTTP 5xx (upstream broken — logged as kind=http_5xx)
 *  - Transport errors (DNS, TLS, connection refused, abort — kind=transport)
 *  - Malformed response bodies (kind=parse)
 *
 * The outer try/catch is load-bearing: if anyone later wraps this function
 * with `.catch(() => true)` for "resilience", they can still exploit it,
 * but at least nothing this function does will throw into the caller's
 * catch block and silently fail open.
 *
 * `fetcher` defaults to the real `pveFetch`; tests inject a stub.
 */
export async function userHasPrivilege(
  session: PVEAuthSession,
  path: string,
  privilege: string,
  fetcher: typeof pveFetch = pveFetch,
): Promise<boolean> {
  const qs = new URLSearchParams({ path, userid: session.username }).toString();
  const url = `https://${session.proxmoxHost}:8006/api2/json/access/permissions?${qs}`;

  try {
    const res = await fetcher(url, {
      headers: { Cookie: `PVEAuthCookie=${session.ticket}` },
    });
    if (res.status >= 500) {
      logProbeError('http_5xx', path, session.username, `status=${res.status}`);
      return false;
    }
    if (!res.ok) return false;
    let body: PermissionsResponse;
    try {
      body = (await res.json()) as PermissionsResponse;
    } catch (err) {
      logProbeError('parse', path, session.username, `error=${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    const entry = body.data?.[path];
    return Boolean(entry && entry[privilege]);
  } catch (err) {
    logProbeError('transport', path, session.username, `error=${err instanceof Error ? err.message : String(err)}`);
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

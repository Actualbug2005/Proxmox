/**
 * POST /api/nas/mount — bind-mount a NAS share into an LXC via the PVE
 * config API. Equivalent to pct set <vmid> -mpN /host/path,mp=/guest/path
 * but goes through the REST endpoint directly (pct itself is a thin
 * shell wrapper over the same config PUT).
 *
 * Body:
 *   node       — PVE node hosting the container
 *   shareId    — opaque provider id resolving to a host path
 *   vmid       — target LXC
 *   guestPath  — absolute mount point inside the guest (e.g. /mnt/videos)
 *   readOnly?  — default false
 *   shared?    — default true (so PVE propagates mp across cluster nodes)
 *
 * Auth chain:
 *   Session + CSRF + Sys.Modify on /nodes/<node>  (container config write)
 *
 * Algorithm:
 *   1. Resolve shareId -> host path via the NAS provider.
 *   2. GET /nodes/{node}/lxc/{vmid}/config, find the lowest free mpN slot.
 *   3. PUT the new mpN value.
 *
 * LXC must be stopped or support hotplug; PVE returns an error if not.
 * We don't auto-stop — the operator owns that call.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import { requireNodeSysModify } from '@/lib/permissions';
import { NODE_RE } from '@/lib/remote-shell';
import { getNasProvider } from '@/lib/nas/registry';
import { pveFetch } from '@/lib/pve-fetch';

const ID_RE = /^[A-Za-z0-9_-]+=*$/;
const MAX_MP_SLOT = 255;

interface MountBody {
  node?: string;
  shareId?: string;
  vmid?: number;
  guestPath?: string;
  readOnly?: boolean;
  shared?: boolean;
}

export const POST = withCsrf(async (req, { session }) => {
  const body = (await req.json().catch(() => ({}))) as MountBody;

  if (!body.node || !NODE_RE.test(body.node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }
  if (!body.shareId || !ID_RE.test(body.shareId)) {
    return NextResponse.json({ error: 'Invalid or missing shareId' }, { status: 400 });
  }
  const vmid = Number(body.vmid);
  if (!Number.isInteger(vmid) || vmid < 100 || vmid > 999_999_999) {
    return NextResponse.json({ error: 'Invalid vmid' }, { status: 400 });
  }
  if (
    typeof body.guestPath !== 'string' ||
    !body.guestPath.startsWith('/') ||
    body.guestPath.includes('..') ||
    body.guestPath.length > 255 ||
    /[,=\n\s]/.test(body.guestPath)
  ) {
    return NextResponse.json(
      { error: 'guestPath must be an absolute path without ".." or special characters' },
      { status: 400 },
    );
  }

  if (!(await requireNodeSysModify(session, body.node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Modify required on /nodes/${body.node}` },
      { status: 403 },
    );
  }

  let hostPath: string;
  try {
    const shares = await getNasProvider(body.node).getShares(body.node);
    const share = shares.find((s) => s.id === body.shareId);
    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }
    hostPath = share.path;
  } catch (err) {
    return NextResponse.json(
      { error: `Share lookup failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  // Raw PVE call — the typed client only declares mp0/mp1 but real
  // containers can carry arbitrary mpN up to 255.
  const configUrl = `https://${session.proxmoxHost}:8006/api2/json/nodes/${encodeURIComponent(body.node)}/lxc/${vmid}/config`;
  let occupied: Set<number>;
  try {
    const res = await pveFetch(configUrl, {
      method: 'GET',
      headers: { Cookie: `PVEAuthCookie=${session.ticket}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `PVE config read failed: ${res.status} ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as { data?: Record<string, unknown> };
    const data = json.data ?? {};
    occupied = new Set(
      Object.keys(data)
        .map((k) => /^mp(\d+)$/.exec(k))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number.parseInt(m[1], 10))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= MAX_MP_SLOT),
    );
  } catch (err) {
    return NextResponse.json(
      { error: `PVE config read failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  let slot = -1;
  for (let i = 0; i <= MAX_MP_SLOT; i++) {
    if (!occupied.has(i)) { slot = i; break; }
  }
  if (slot === -1) {
    return NextResponse.json(
      { error: `All mp0..mp${MAX_MP_SLOT} slots are occupied on vmid=${vmid}` },
      { status: 409 },
    );
  }

  const shared = body.shared === false ? 0 : 1;
  const readOnly = body.readOnly === true ? ',ro=1' : '';
  const mpValue = `${hostPath},mp=${body.guestPath}${readOnly},shared=${shared}`;

  const setForm = new URLSearchParams();
  setForm.set(`mp${slot}`, mpValue);

  try {
    const res = await pveFetch(configUrl, {
      method: 'PUT',
      headers: {
        Cookie: `PVEAuthCookie=${session.ticket}`,
        CSRFPreventionToken: session.csrfToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: setForm.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `PVE config write failed: ${res.status} ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      slot,
      mp: `mp${slot}`,
      hostPath,
      guestPath: body.guestPath,
      readOnly: Boolean(body.readOnly),
      shared: Boolean(shared),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `PVE config write failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
});

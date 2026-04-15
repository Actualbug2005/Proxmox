/**
 * Unified NAS shares API.
 *
 * Both verbs dispatch to the provider resolved by `getNasProvider(node)`.
 * Protocol-specific (SMB vs NFS) logic lives inside the provider — the route
 * only handles auth, validation, and error surfaces.
 *
 * Auth chain:
 *   GET  — Session + Sys.Audit on /nodes/<node>     (read-only listing)
 *   POST — Session + CSRF + Sys.Modify on /nodes/<node>  (mutating)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { requireNodeSysAudit, requireNodeSysModify } from '@/lib/permissions';
import { NODE_RE } from '@/lib/remote-shell';
import { getNasProvider } from '@/lib/nas/registry';
import type { CreateNasSharePayload, NasProtocol } from '@/types/nas';

// ─── GET /api/nas/shares?node=<name> ────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const node = req.nextUrl.searchParams.get('node') ?? '';
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }

  if (!(await requireNodeSysAudit(session, node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Audit required on /nodes/${node}` },
      { status: 403 },
    );
  }

  try {
    const shares = await getNasProvider(node).getShares(node);
    return NextResponse.json({ shares });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

// ─── POST /api/nas/shares ───────────────────────────────────────────────────

/** Raw JSON body. All fields optional because the validator is the gate. */
interface CreateRequestBody {
  node?: string;
  name?: string;
  path?: string;
  protocols?: NasProtocol[];
  readOnly?: boolean;
}

/**
 * Validate + normalise a create-share payload.
 *
 * Returns [payload, null] on success or [null, errorMessage] on rejection.
 *
 * TODO(daisy): implement this. See guidance in the chat message that
 * introduced this scaffold — the right policy here is a domain call:
 *
 *   • path  — homelab-friendly vs. strict (must live under /mnt/? /tank/?
 *             reject '..'? resolve symlinks?)
 *   • name  — SMB has hard rules (no slashes, 1..80 chars, no control
 *             chars); NFS is lenient. Taking the SMB-strict intersection
 *             keeps shares protocol-portable.
 *   • protocols — must be a non-empty subset of ['smb', 'nfs'].
 *   • readOnly  — default false when unspecified.
 *
 * Trade-off: stricter rejection means cleaner errors up-front at the cost
 * of occasionally blocking exotic-but-legitimate paths. Looser validation
 * defers errors to the backend (`exportfs` / `smbcontrol reload-config`),
 * which produces uglier messages but fewer false rejections.
 */
function validateCreatePayload(
  _body: CreateRequestBody,
): [CreateNasSharePayload, null] | [null, string] {
  throw new Error('validateCreatePayload not implemented — see TODO');
}

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as CreateRequestBody;
  const node = body.node ?? '';
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }

  if (!(await requireNodeSysModify(session, node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Modify required on /nodes/${node}` },
      { status: 403 },
    );
  }

  const [payload, err] = validateCreatePayload(body);
  if (err !== null) {
    return NextResponse.json({ error: err }, { status: 400 });
  }

  try {
    const share = await getNasProvider(node).createShare(node, payload);
    return NextResponse.json({ share }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

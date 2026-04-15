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
 * Policy chosen by the operator:
 *   • name      — strict: 1..64 chars, [A-Za-z0-9_.-] only (no shell metas).
 *   • path      — absolute, no '..' directory traversal.
 *   • protocols — non-empty subset of {smb, nfs}, deduplicated, lowercased.
 *   • readOnly  — defaults to true (security-first).
 */
function validateCreatePayload(body: any): [CreateNasSharePayload, null] | [null, string] {
  const { name, path, protocols, readOnly } = body;

  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(name)) {
    return [null, "Invalid name: Must be 1-64 characters, alphanumeric, dashes, or underscores."];
  }

  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) {
    return [null, "Invalid path: Must be an absolute path without directory traversal (..)."];
  }

  if (!Array.isArray(protocols) || protocols.length === 0) {
    return [null, "Invalid protocols: Must provide at least one protocol."];
  }

  const validProtocols = new Set(['smb', 'nfs']);
  const requestedProtocols = new Set(protocols.map((p) => String(p).toLowerCase()));
  const finalProtocols: ('smb' | 'nfs')[] = [];

  for (const p of requestedProtocols) {
    if (!validProtocols.has(p)) return [null, `Invalid protocol: ${p}`];
    finalProtocols.push(p as 'smb' | 'nfs');
  }

  const finalReadOnly = typeof readOnly === 'boolean' ? readOnly : true;

  return [{ name, path, protocols: finalProtocols, readOnly: finalReadOnly }, null];
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

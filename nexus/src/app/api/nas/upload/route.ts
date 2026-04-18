/**
 * POST /api/nas/upload — multipart file upload into a share directory.
 *
 * Body: multipart/form-data with fields
 *   node      — PVE node the share lives on
 *   shareId   — opaque provider id
 *   subDir    — path relative to share root (may be '')
 *   file      — the file blob
 *
 * Auth chain:
 *   Session + CSRF + Sys.Modify on /nodes/<node>
 *
 * Size cap is enforced twice: once on the incoming Content-Length (so we
 * don't buffer 10 GB just to reject it), and again in the provider once
 * the bytes are in memory.
 */
import { NextResponse } from 'next/server';
import { withCsrf } from '@/lib/route-middleware';
import { requireNodeSysModify } from '@/lib/permissions';
import { NODE_RE } from '@/lib/remote-shell';
import { getNasProvider } from '@/lib/nas/registry';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const POST = withCsrf(async (req, { session }) => {
  const declaredLength = Number.parseInt(req.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES * 2) {
    // 2× the cap lets the multipart envelope through (it has its own
    // framing overhead) while rejecting obvious "upload a 1 GB blob"
    // cases before we buffer them.
    return NextResponse.json(
      { error: `Payload too large (cap is ${MAX_UPLOAD_BYTES} bytes)` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid multipart body: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  const node = String(form.get('node') ?? '');
  if (!NODE_RE.test(node)) {
    return NextResponse.json({ error: 'Invalid or missing node' }, { status: 400 });
  }
  if (!(await requireNodeSysModify(session, node))) {
    return NextResponse.json(
      { error: `Forbidden: Sys.Modify required on /nodes/${node}` },
      { status: 403 },
    );
  }

  const shareId = String(form.get('shareId') ?? '');
  if (!shareId || !/^[A-Za-z0-9_-]+=*$/.test(shareId)) {
    return NextResponse.json({ error: 'Invalid or missing shareId' }, { status: 400 });
  }

  const subDir = String(form.get('subDir') ?? '');
  // Provider re-validates this, but fail early on traversal so the error
  // comes from the API (fast) rather than a 502 (looks like PVE broke).
  if (subDir.includes('..') || subDir.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid subDir' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file part' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large (cap is ${MAX_UPLOAD_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    await getNasProvider(node).uploadFile(node, shareId, subDir, file.name, bytes);
    return NextResponse.json({ ok: true, filename: file.name, size: file.size }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});

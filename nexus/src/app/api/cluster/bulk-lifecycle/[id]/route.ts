/**
 * /api/cluster/bulk-lifecycle/[id] — per-batch detail + cancel.
 *
 * GET    — return the batch if owned by the caller.
 * DELETE — request cancel; flips pending items to skipped. Running items
 *          keep running (PVE tasks can't be cancelled cleanly).
 *
 * 404 is used for "not found" and "not yours" alike so a different user
 * can't probe for batch ids.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { cancelBatch, getBatch } from '@/lib/bulk-ops';
import { toDto } from '../route';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const batch = getBatch(id);
  if (!batch || batch.user !== session.username) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ batch: toDto(batch) });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const batch = getBatch(id);
  if (!batch || batch.user !== session.username) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  cancelBatch(id);
  const after = getBatch(id);
  return NextResponse.json({ batch: after ? toDto(after) : null });
}

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

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { cancelBatch, getBatch } from '@/lib/bulk-ops';
import { toDto } from '../route';

export const GET = withAuth<{ id: string }>(async (_req, { params, session }) => {
  const { id } = await params;
  const batch = getBatch(id);
  if (!batch || batch.user !== session.username) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ batch: toDto(batch) });
});

export const DELETE = withCsrf<{ id: string }>(async (_req, { params, session }) => {
  const { id } = await params;
  const batch = getBatch(id);
  if (!batch || batch.user !== session.username) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  cancelBatch(id);
  const after = getBatch(id);
  return NextResponse.json({ batch: after ? toDto(after) : null });
});

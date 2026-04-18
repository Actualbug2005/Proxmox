/**
 * GET /api/guests/[node]/[vmid]/agent — on-demand guest-agent probe.
 *
 * Thin wrapper around `probeGuest()`. Used by the VM detail drawer
 * ("refresh fs info") and by the bento widget's single-row refresh.
 * The scheduled poll source (5.2.C) calls `probeGuest` directly, not
 * through this HTTP route.
 *
 * Response is the raw GuestProbe — reachable flag, reason, filesystems
 * with bytes. The UI computes usedPct itself.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { probeGuest } from '@/lib/guest-agent/probe';

interface Params {
  node: string;
  vmid: string;
}

export const GET = withAuth<Params>(async (_req, { params, session }) => {
  const { node, vmid: vmidRaw } = await params;
  const vmid = Number.parseInt(vmidRaw, 10);
  if (!Number.isFinite(vmid) || vmid <= 0) {
    return NextResponse.json({ error: 'invalid vmid' }, { status: 400 });
  }
  const probe = await probeGuest({ session, node, vmid });
  return NextResponse.json(probe, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});

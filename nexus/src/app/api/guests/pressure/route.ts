/**
 * GET /api/guests/pressure — cluster-wide guest disk-pressure roll-up.
 *
 * Reads the poll-source snapshot. Returns quickly (in-memory), so the
 * bento widget can poll at the same cadence as other dashboard widgets
 * without hammering the guest agents.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { getSnapshot } from '@/lib/guest-agent/snapshot';

export const GET = withAuth(async () => {
  const snap = getSnapshot();
  return NextResponse.json(
    {
      updatedAt: snap.updatedAt,
      pressures: snap.pressures,
      unreachable: snap.probes
        .filter((p) => !p.reachable)
        .map((p) => ({ vmid: p.vmid, node: p.node, reason: p.reason ?? '' })),
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
});

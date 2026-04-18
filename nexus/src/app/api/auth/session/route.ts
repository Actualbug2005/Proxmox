import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';

export const GET = withAuth(async (_req, { session }) => {
  return NextResponse.json({
    authenticated: true,
    username: session.username,
    proxmoxHost: session.proxmoxHost,
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { acquirePVETicket, startSession } from '@/lib/auth';

// TLS verification for PVE's self-signed cert is handled inside pveFetch
// (src/lib/pve-fetch.ts), which is scoped to the PVE host only. We do NOT
// set NODE_TLS_REJECT_UNAUTHORIZED globally anymore — that leaked to every
// outbound request in the Node process.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password, realm = 'pam', host } = body as {
      username: string;
      password: string;
      realm?: string;
      host?: string;
    };

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const proxmoxHost = host ?? process.env.PROXMOX_HOST ?? 'localhost';
    const ticket = await acquirePVETicket(proxmoxHost, username, password, realm);

    const { csrfToken } = await startSession({
      ticket: ticket.ticket,
      csrfToken: ticket.CSRFPreventionToken,
      username: ticket.username,
      proxmoxHost,
    });

    return NextResponse.json({
      username: ticket.username,
      clustername: ticket.clustername,
      csrfToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

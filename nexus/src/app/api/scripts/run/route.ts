/**
 * Execute a community script on a Proxmox node.
 *
 * Strategy: The Proxmox API doesn't have a "run arbitrary shell script" endpoint.
 * Instead we use nodes/{node}/execute (available in recent PVE) which runs a command
 * directly. For the community scripts, we curl | bash the script URL.
 *
 * NOTE: This requires the Proxmox node to have internet access, or the script URL
 * to be reachable from the node.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { node, scriptUrl, scriptName } = (await req.json()) as {
    node: string;
    scriptUrl: string;
    scriptName: string;
  };

  if (!node || !scriptUrl) {
    return NextResponse.json({ error: 'node and scriptUrl are required' }, { status: 400 });
  }

  // Validate URL is from the trusted community-scripts repo
  const trustedOrigins = [
    'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/',
    'https://github.com/community-scripts/ProxmoxVE/',
  ];
  if (!trustedOrigins.some((origin) => scriptUrl.startsWith(origin))) {
    return NextResponse.json({ error: 'Untrusted script URL' }, { status: 400 });
  }

  const host = session.proxmoxHost;
  const command = `bash <(curl -fsSL '${scriptUrl}')`;

  // Use nodes/{node}/execute (PVE 7+)
  const executeUrl = `https://${host}:8006/api2/json/nodes/${node}/execute`;

  const res = await fetch(executeUrl, {
    method: 'POST',
    headers: {
      Cookie: `PVEAuthCookie=${session.ticket}`,
      CSRFPreventionToken: session.csrfToken,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ commands: command }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    // Fallback: return UPID from a task if available
    return NextResponse.json(
      { error: `Execute failed: ${text}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json({ upid: data.data, node, scriptName });
}

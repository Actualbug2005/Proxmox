/**
 * Cluster-wide shell executor.
 *
 * Auth chain:
 *   1. Valid Nexus session cookie
 *   2. Matching X-Nexus-CSRF header (double-submit)
 *   3. Caller holds Sys.Modify on /nodes/<targetNode> via the PVE ACL
 *
 * The command payload is piped over stdin — it never touches argv, so no
 * amount of shell metacharacters in it can affect how ssh/bash itself is
 * invoked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { hostname } from 'node:os';
import { getSession, getSessionId } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { requireNodeSysModify } from '@/lib/permissions';
import { NODE_RE, runScriptOnNode } from '@/lib/remote-shell';

interface ExecRequest {
  command: string;
  node?: string;
  timeoutMs?: number;
}

export async function POST(req: NextRequest) {
  const sessionId = await getSessionId();
  if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCsrf(req, sessionId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as ExecRequest;
  if (!body?.command || typeof body.command !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid "command"' }, { status: 400 });
  }

  const localHost = hostname();
  const targetNode = body.node && body.node !== localHost ? body.node : localHost;

  if (!NODE_RE.test(targetNode)) {
    return NextResponse.json({ error: `Invalid node name: ${targetNode}` }, { status: 400 });
  }

  if (!(await requireNodeSysModify(session, targetNode))) {
    return NextResponse.json(
      { error: 'Forbidden: Sys.Modify required on /nodes/' + targetNode },
      { status: 403 },
    );
  }

  try {
    const result = await runScriptOnNode(targetNode, body.command, { timeoutMs: body.timeoutMs });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}

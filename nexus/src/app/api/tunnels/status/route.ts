/**
 * Read-only tunnel-provider status probe.
 *
 * Why a dedicated route instead of /api/exec:
 *   /api/exec is a generic shell runner, gated by Sys.Modify because there
 *   is no mechanical way to constrain an arbitrary command to "read-only".
 *   This route never accepts executable input from the client — the bash
 *   payload is selected from a server-side const map keyed by a fixed enum
 *   of provider ids. That makes Sys.Audit a safe gate.
 *
 * Auth chain (GET, no CSRF needed for non-mutating reads):
 *   1. Valid Nexus session cookie
 *   2. Caller holds Sys.Audit (or Sys.Modify) on /nodes/<node>
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-middleware';
import { requireNodeSysAudit } from '@/lib/permissions';
import { NODE_RE, runScriptOnNode } from '@/lib/remote-shell';
import type { TunnelProviderId, TunnelStatus } from '@/types/tunnels';

// Re-aliased locally so the rest of this file (probes map, parser) reads
// naturally; the canonical definitions live in `@/types/tunnels`.
type ProviderId = TunnelProviderId;

/**
 * Hardcoded bash literals — one per supported provider. The client cannot
 * influence which script runs beyond selecting an id from this set; adding
 * a provider requires a server-side code change.
 */
const PROBES: Readonly<Record<ProviderId, string>> = {
  cloudflared: `if ! command -v cloudflared >/dev/null 2>&1; then
  echo not-installed
elif ! systemctl cat cloudflared >/dev/null 2>&1; then
  echo not-configured
elif systemctl is-active cloudflared >/dev/null 2>&1; then
  echo active
else
  echo stopped
fi`,
  ngrok: `if ! command -v ngrok >/dev/null 2>&1; then
  echo not-installed
elif ! systemctl cat ngrok >/dev/null 2>&1; then
  echo not-configured
elif systemctl is-active ngrok >/dev/null 2>&1; then
  echo active
else
  echo stopped
fi`,
};

const SUPPORTED: readonly ProviderId[] = ['cloudflared', 'ngrok'];

/** Run all known provider probes in a single bash invocation per node so
 *  the ssh round-trip cost is amortised. The server stitches the per-id
 *  output back into a typed map. */
function buildBatchedScript(): string {
  return SUPPORTED.map(
    (id) => `echo "BEGIN:${id}"
${PROBES[id]}
echo "END:${id}"`,
  ).join('\n');
}

function parseBatchedOutput(stdout: string): Record<ProviderId, TunnelStatus> {
  const out: Record<ProviderId, TunnelStatus> = {
    cloudflared: 'unknown',
    ngrok: 'unknown',
  };
  for (const id of SUPPORTED) {
    const re = new RegExp(`BEGIN:${id}\\s*\\n([\\s\\S]*?)\\nEND:${id}`);
    const m = stdout.match(re);
    if (!m) continue;
    const value = m[1].trim();
    if (
      value === 'not-installed' ||
      value === 'not-configured' ||
      value === 'stopped' ||
      value === 'active'
    ) {
      out[id] = value;
    }
  }
  return out;
}

export const GET = withAuth(async (req, { session }) => {
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
    // 30s ceiling: probes are tiny but ssh setup can be slow on a fresh node.
    const result = await runScriptOnNode(node, buildBatchedScript(), { timeoutMs: 30_000 });
    if (result.exitCode !== 0) {
      return NextResponse.json(
        { error: `Probe exited ${result.exitCode}: ${result.stderr.slice(0, 200)}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ providers: parseBatchedOutput(result.stdout) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
});

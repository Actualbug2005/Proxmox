/**
 * In-app updater trigger.
 *
 * POST /api/system/update          → install latest release
 * POST /api/system/update {version}→ install a pinned tag
 *
 * Auth chain:
 *   1. Valid Nexus session cookie
 *   2. Matching X-Nexus-CSRF header (double-submit)
 *
 * Safety properties:
 *   - We invoke /usr/local/bin/nexus-update via execFile (no shell), so even
 *     a broken CSRF check couldn't inject shell metacharacters.
 *   - The optional `version` body field is validated against a strict regex
 *     before being passed as an argv element.
 *   - nexus-update writes the tarball to a versioned releases/ dir, flips
 *     the /opt/nexus/current symlink, then schedules a systemd-timed
 *     restart 3 seconds in the future. That gives this response time to
 *     flush before the process is killed.
 */
import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withCsrf } from '@/lib/route-middleware';

const execFileAsync = promisify(execFile);

const UPDATER = process.env.NEXUS_UPDATER_BIN ?? '/usr/local/bin/nexus-update';
// Release tags are SemVer: `v0.2.0`, `v1.0.0`, optionally with a pre-release
// suffix like `v0.3.0-rc.1`. Reject anything that doesn't match — prevents
// argv injection via a crafted `version` body.
// SemVer tag validation split into an anchor pattern + optional pre-release
// check. Combined regex tripped safe-regex's nested-quantifier heuristic.
const VERSION_CORE_RE = /^v\d+\.\d+\.\d+$/;
const VERSION_PRERELEASE_RE = /^v\d+\.\d+\.\d+-[A-Za-z0-9.-]{1,64}$/;
const VERSION_RE = {
  test: (s: string): boolean => VERSION_CORE_RE.test(s) || VERSION_PRERELEASE_RE.test(s),
};

interface UpdateRequest {
  version?: string;
}

export const POST = withCsrf(async (req) => {
  let body: UpdateRequest = {};
  // Accept empty bodies (install latest). Tolerate malformed JSON to keep the
  // endpoint trivially callable from the UI without fussy content-type headers.
  try {
    body = (await req.json()) as UpdateRequest;
  } catch {
    body = {};
  }

  const args: string[] = [];
  if (typeof body.version === 'string' && body.version.length > 0) {
    if (!VERSION_RE.test(body.version)) {
      return NextResponse.json(
        { error: 'Invalid version tag format' },
        { status: 400 },
      );
    }
    args.push('--version', body.version);
  }

  try {
    // execFile, not exec — argv is passed as an array, no shell interpolation.
    // The updater handles its own logging via systemd journal; we just need
    // its final tag output on stdout for our response.
    const { stdout } = await execFileAsync(UPDATER, args, {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const installed = stdout.trim().split('\n').pop() ?? '';
    return NextResponse.json(
      {
        ok: true,
        installed,
        message: 'Update scheduled — nexus will restart in ~3 seconds',
      },
      { headers: { 'Cache-Control': 'no-store, private' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Updater failed: ${msg}` },
      { status: 500, headers: { 'Cache-Control': 'no-store, private' } },
    );
  }
});

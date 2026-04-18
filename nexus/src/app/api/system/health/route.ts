/**
 * GET /api/system/health
 *
 * Operator visibility for the silent-failure surface flagged in the
 * 2026-04-18 audit. Surfaces every counter that previously only existed
 * inside a `console.error` line.
 *
 * Auth: any valid Nexus session. The numbers themselves are non-sensitive
 * (failure counts + backend kind) but unauthenticated polling would still
 * leak service-uptime / Redis-presence to the public — gate it.
 *
 * Caller pattern: scrape every 30–60s, alert when any counter delta exceeds
 * a per-deployment threshold OR when sessionBackend flips from `redis` to
 * `memory` mid-process (that means the H9 auto-fallback fired).
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { getSession, getRenewalFailureCount } from '@/lib/auth';
import { getPermissionProbeErrorCount } from '@/lib/permissions';
import { getAuditWriteFailureCount } from '@/lib/exec-audit';
import { getSchedulerFireFailureCount } from '@/lib/scheduler';
import { getSessionBackendKind, type SessionBackendKind } from '@/lib/session-store';

const VERSION_FILE = process.env.NEXUS_VERSION_FILE ?? '/opt/nexus/current/VERSION';

async function readCurrentVersion(): Promise<string> {
  try {
    const v = (await readFile(VERSION_FILE, 'utf8')).trim();
    return v.length > 0 ? v : 'unknown';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'dev';
    return 'unknown';
  }
}

export interface HealthResponse {
  status: 'ok';
  uptimeMs: number;
  version: string;
  session: { backend: SessionBackendKind };
  counters: {
    renewalFailures: number;
    permissionProbeErrors: number;
    auditWriteFailures: number;
    schedulerFireFailures: number;
  };
}

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: HealthResponse = {
    status: 'ok',
    uptimeMs: Math.floor(process.uptime() * 1000),
    version: await readCurrentVersion(),
    session: { backend: getSessionBackendKind() },
    counters: {
      renewalFailures: getRenewalFailureCount(),
      permissionProbeErrors: getPermissionProbeErrorCount(),
      auditWriteFailures: getAuditWriteFailureCount(),
      schedulerFireFailures: getSchedulerFireFailureCount(),
    },
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

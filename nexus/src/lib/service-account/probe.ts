import { pveFetchWithToken } from '../pve-fetch.ts';
import type { ServiceAccountSession } from './types.ts';

const PROBE_TIMEOUT_MS = 5000;

export async function probeServiceAccount(
  session: ServiceAccountSession,
): Promise<{ ok: true; userid: string } | { ok: false; error: string }> {
  const userid = session.tokenId;
  const url = `https://${session.proxmoxHost}:8006/api2/json/access/permissions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await pveFetchWithToken(session, url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body || res.statusText}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    if (!json || !json.data) {
      return { ok: false, error: 'PVE returned a success response with no data map' };
    }
    return { ok: true, userid };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

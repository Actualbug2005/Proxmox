/**
 * ntfy destination — POST text body to a topic URL.
 *
 * ntfy's HTTP protocol:
 *   - Body is the raw message (plain text).
 *   - `Title` header is the push-notification title.
 *   - `Tags` header is a CSV of emoji shortcodes; we tag resolved
 *     notifications with ✅ and alerts with ⚠️ so the phone UI visually
 *     splits them.
 *   - `Priority` header 1-5; we bump alerts to `high` (4) so they
 *     bypass a phone's Do-Not-Disturb when that's allowed, and leave
 *     resolves at `default` (3).
 *   - Optional `Authorization: Basic <base64>` when the topic is behind
 *     ACL; stored plaintext credential (`user:pass`) lives in the
 *     encrypted blob.
 *
 * Doc ref: https://docs.ntfy.sh/publish/
 */

import type { NtfyDestination } from '../types.ts';
import type { DispatchPayload, DispatchResult, DispatchFetcher } from './types.ts';

export async function dispatch(
  config: NtfyDestination,
  payload: DispatchPayload,
  fetcher: DispatchFetcher,
): Promise<DispatchResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'User-Agent': 'Nexus/notifications',
    Priority: payload.resolved ? 'default' : 'high',
    Tags: payload.resolved ? 'white_check_mark' : 'warning',
  };
  if (payload.title) headers.Title = payload.title;
  if (config.basicAuth) {
    // Base64 the "user:pass" pair at dispatch time so the token only
    // lives in memory during the request lifetime.
    headers.Authorization = `Basic ${Buffer.from(config.basicAuth, 'utf8').toString('base64')}`;
  }

  try {
    const res = await fetcher(config.topicUrl, {
      method: 'POST',
      headers,
      body: payload.message,
    });
    if (res.ok) return { outcome: 'sent', status: res.status };
    return {
      outcome: 'failed',
      status: res.status,
      reason: `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

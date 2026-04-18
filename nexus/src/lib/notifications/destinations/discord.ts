/**
 * Discord webhook destination.
 *
 * Discord's incoming-webhook API accepts POST JSON with:
 *   content: string   (the message body, ≤ 2000 chars)
 *   username: string  (optional override)
 *   embeds[]          (richer card — we use for resolve vs alert colouring)
 *
 * We use embeds so a resolved notification renders green and an alert
 * renders red — operators scanning a channel see the shape difference
 * at a glance.
 *
 * Body is truncated to 1900 chars with an "…" tail so we leave headroom
 * for Discord's server-side length check (it's 2000 for `content` and
 * 4096 for embed descriptions, but staying well under avoids "invalid
 * body" 400s on edge cases we haven't measured).
 *
 * Doc ref: https://discord.com/developers/docs/resources/webhook
 */

import type { DiscordDestination } from '../types.ts';
import type { DispatchPayload, DispatchResult, DispatchFetcher } from './types.ts';

const MAX_DESCRIPTION_LEN = 1900;
const ALERT_COLOR = 0xdc2626; // red-600 — matches --color-err in light mode
const RESOLVE_COLOR = 0x10b981; // emerald-500

function truncate(s: string): string {
  return s.length > MAX_DESCRIPTION_LEN ? s.slice(0, MAX_DESCRIPTION_LEN - 1) + '…' : s;
}

export async function dispatch(
  config: DiscordDestination,
  payload: DispatchPayload,
  fetcher: DispatchFetcher,
): Promise<DispatchResult> {
  const embed = {
    title: payload.title ?? (payload.resolved ? 'Resolved' : 'Alert'),
    description: truncate(payload.message),
    color: payload.resolved ? RESOLVE_COLOR : ALERT_COLOR,
    timestamp: new Date(payload.at).toISOString(),
    footer: { text: `Nexus · ${payload.kind}${payload.scope ? ` · ${payload.scope}` : ''}` },
  };
  const body = JSON.stringify({
    username: 'Nexus',
    embeds: [embed],
  });

  try {
    const res = await fetcher(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Nexus/notifications',
      },
      body,
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

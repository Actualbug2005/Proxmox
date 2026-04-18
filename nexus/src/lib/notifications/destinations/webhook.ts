/**
 * Generic webhook destination — POSTs a JSON body to an operator-chosen URL.
 *
 * Shape:
 *   Content-Type: application/json
 *   X-Nexus-Signature: sha256=<hex>   (only when hmacSecret is set)
 *   Body: { title?, message, kind, at, scope? }
 *
 * The HMAC is computed over the raw request body (UTF-8 bytes) using
 * `hmacSecret`. Receivers should reject the request if the header is
 * missing or the digest doesn't match — that's the whole point of
 * storing the secret in the destination config.
 *
 * SSRF note: the URL is operator-supplied at rule-creation time, so
 * it's trusted input for this process. If future work exposes
 * destination creation to non-admin Nexus users, we'd want a
 * ssrf-req-filter pass here to reject private-IP / localhost targets.
 */

import { createHmac } from 'node:crypto';
import type { WebhookDestination } from '../types.ts';
import type { DispatchPayload, DispatchResult, DispatchFetcher } from './types.ts';

export async function dispatch(
  config: WebhookDestination,
  payload: DispatchPayload,
  fetcher: DispatchFetcher,
): Promise<DispatchResult> {
  const bodyObj: Record<string, unknown> = {
    kind: payload.kind,
    at: new Date(payload.at).toISOString(),
    message: payload.message,
  };
  if (payload.title) bodyObj.title = payload.title;
  if (payload.scope) bodyObj.scope = payload.scope;
  if (payload.resolved) bodyObj.resolved = true;
  const body = JSON.stringify(bodyObj);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Nexus/notifications',
  };
  if (config.hmacSecret) {
    const sig = createHmac('sha256', config.hmacSecret).update(body).digest('hex');
    headers['X-Nexus-Signature'] = `sha256=${sig}`;
  }

  try {
    const res = await fetcher(config.url, { method: 'POST', headers, body });
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

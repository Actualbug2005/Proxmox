/**
 * Common I/O contract for all three dispatchers.
 *
 * DispatchPayload is the intermediate form the rule + event + template
 * are compiled into; the three transport modules (webhook, ntfy, discord)
 * each translate it to the shape their upstream expects.
 *
 * DispatchFetcher is injected so tests can swap in a stub. Production
 * uses the global `fetch` (undici under the hood on Node 22).
 */

export interface DispatchPayload {
  /** The rule's event-kind — so the receiver can filter on it. */
  kind: string;
  /** Unix ms of the originating event. */
  at: number;
  /** Rendered message (from the rule's template + event context). */
  message: string;
  /** Optional rule title — Discord/ntfy use it as the title line. */
  title?: string;
  /** Rule scope, if any. */
  scope?: string;
  /** True when this is a "predicate cleared" notification, not an alert. */
  resolved?: boolean;
}

export interface DispatchResult {
  outcome: 'sent' | 'failed';
  /** Upstream HTTP status, when the request completed. */
  status?: number;
  /** Operator-facing detail on failure. */
  reason?: string;
}

/**
 * Minimal subset of `fetch` the dispatchers need — extracted so tests
 * can stub without pulling in a full undici mock.
 */
export type DispatchFetcher = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; statusText: string }>;

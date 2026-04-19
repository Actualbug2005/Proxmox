/**
 * Dispatcher — orchestrates the full pipeline:
 *
 *   event-bus  →  rule-matcher  →  backoff planner  →  destination transport
 *
 * Pure business logic lives in `rule-matcher.ts` and `backoff.ts`; this
 * module handles the I/O choreography (read rules, decrypt destinations,
 * pick a transport, POST, record the outcome, persist the state patch).
 *
 * No polling source lives here — Phase C will add that as an additional
 * emitter on top of `emit()` in event-bus. The dispatcher doesn't care
 * how an event got onto the bus.
 */

import { emit, subscribe, type EventHandler } from './event-bus.ts';
import { planFire } from './backoff.ts';
import { humaniseFiringFor, renderTemplate } from './template.ts';
import { contextFor, rulesForEvent } from './rule-matcher.ts';
import {
  decryptDestination,
  getDestination,
  listRules,
  markRuleFired,
} from './store.ts';
import { dispatch as webhookDispatch } from './destinations/webhook.ts';
import { dispatch as ntfyDispatch } from './destinations/ntfy.ts';
import { dispatch as discordDispatch } from './destinations/discord.ts';
import { dispatch as emailDispatch } from './destinations/email.ts';
import type {
  DestinationConfig,
  DispatchRecord,
  NotificationEvent,
  Rule,
} from './types.ts';
import type { DispatchFetcher, DispatchResult } from './destinations/types.ts';

// ─── Recent-records ring buffer ─────────────────────────────────────────────
// Powers the UI "last 50 dispatches" view. Non-persisted by design — on
// restart the buffer resets; durable state lives on the Rule record.

const RING_SIZE = 200;
declare global {

  var __nexusNotifRing: DispatchRecord[] | undefined;
}
function ring(): DispatchRecord[] {
  if (!globalThis.__nexusNotifRing) globalThis.__nexusNotifRing = [];
  return globalThis.__nexusNotifRing;
}
export function recentDispatches(limit = 50): DispatchRecord[] {
  const buf = ring();
  return buf.slice(Math.max(0, buf.length - limit)).reverse();
}
function pushRecord(rec: DispatchRecord): void {
  const buf = ring();
  buf.push(rec);
  if (buf.length > RING_SIZE) buf.splice(0, buf.length - RING_SIZE);
}

// ─── Transport registry ─────────────────────────────────────────────────────

async function transportFor(
  config: DestinationConfig,
  payload: Parameters<typeof webhookDispatch>[1],
  fetcher: DispatchFetcher,
): Promise<DispatchResult> {
  switch (config.kind) {
    case 'webhook': return webhookDispatch(config, payload, fetcher);
    case 'ntfy':    return ntfyDispatch(config, payload, fetcher);
    case 'discord': return discordDispatch(config, payload, fetcher);
    // Email uses nodemailer directly — ignores the HTTP fetcher. Same
    // DispatchResult contract so the dispatcher caller doesn't care
    // whether the transport was HTTP or SMTP.
    case 'email':   return emailDispatch(config, payload);
  }
}

// ─── Default fetcher ───────────────────────────────────────────────────────

const defaultFetcher: DispatchFetcher = async (url, init) => {
  // Use the global fetch (undici on Node 22). The destinations are
  // external HTTPS endpoints, so standard TLS validation applies —
  // unlike `pveFetch` which needs the scoped insecure Agent.
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, statusText: res.statusText };
};

// ─── Main dispatch path ────────────────────────────────────────────────────

export interface DispatchOptions {
  fetcher?: DispatchFetcher;
  now?: () => number;
}

/**
 * Process a single event end-to-end. Called by the subscribe handler
 * below for real events; exported so tests and the poll source can
 * drive the pipeline without going through the bus.
 */
export async function handleEvent(
  event: NotificationEvent,
  opts: DispatchOptions = {},
): Promise<void> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const now = opts.now ? opts.now() : Date.now();
  const rules = await listRules();
  const matches = rulesForEvent(rules, event);
  if (matches.length === 0) return;

  // Build the template context once per event; reused across rules.
  const ctx = contextFor(event);

  // Run rule dispatches in parallel but bounded — a slow Discord call
  // shouldn't hold up a webhook, and a flood of matches shouldn't
  // over-parallelise. Small N (< 10 in practice), so Promise.all is fine.
  await Promise.all(
    matches.map((rule) => dispatchOne(rule, event, ctx, now, fetcher)),
  );
}

async function dispatchOne(
  rule: Rule,
  event: NotificationEvent,
  ctx: ReturnType<typeof contextFor>,
  now: number,
  fetcher: DispatchFetcher,
): Promise<void> {
  const plan = planFire(rule, now);
  if (plan.action === 'skip') {
    pushRecord({
      ruleId: rule.id,
      destinationId: rule.destinationId,
      at: now,
      outcome: 'skipped',
      reason: `backoff: next at ${new Date(plan.nextEligibleAt).toISOString()}`,
    });
    return;
  }

  // Resolve destination and plaintext config. Missing / corrupt = mark
  // failed and bail; the rule's backoff should NOT advance in that case
  // so the operator gets notified again after the fix.
  const dest = await getDestination(rule.destinationId);
  if (!dest) {
    pushRecord({
      ruleId: rule.id,
      destinationId: rule.destinationId,
      at: now,
      outcome: 'failed',
      reason: 'destination missing',
    });
    return;
  }
  let config: DestinationConfig;
  try {
    config = decryptDestination(dest);
  } catch (err) {
    pushRecord({
      ruleId: rule.id,
      destinationId: rule.destinationId,
      at: now,
      outcome: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Pick the template. Resolves use resolveMessageTemplate when set;
  // otherwise fall back to messageTemplate. The distinctive resolve-
  // flavour (Discord green, ntfy emoji, email subject suffix, webhook
  // resolved:true) still fires from the payload.resolved flag below, so
  // authors who leave the resolve template blank get the alert body
  // with a visually distinct wrapper.
  const isResolve = event.__resolve === true;
  const chosenTemplate =
    isResolve && rule.resolveMessageTemplate
      ? rule.resolveMessageTemplate
      : rule.messageTemplate;
  // Inject the firingFor variable for resolve templates. Empty string
  // when we don't have a fire timestamp (e.g. resolve without a prior
  // fire, which shouldn't happen but shouldn't crash either).
  const firingFor =
    isResolve && rule.lastFireAt
      ? humaniseFiringFor(event.at - rule.lastFireAt)
      : '';
  const message = renderTemplate(chosenTemplate, { ...ctx, firingFor });
  const scope = typeof ctx.scope === 'string' ? ctx.scope : undefined;
  const result = await transportFor(
    config,
    {
      kind: event.kind,
      at: event.at,
      message,
      title: rule.title,
      scope,
      // Propagate the internal __resolve marker set by poll-source +
      // sweepPushedClears. Transports branch on this to render a
      // resolve-flavoured notification instead of an alert.
      resolved: event.__resolve === true ? true : undefined,
    },
    fetcher,
  );

  pushRecord({
    ruleId: rule.id,
    destinationId: rule.destinationId,
    at: now,
    outcome: result.outcome,
    status: result.status,
    reason: result.reason,
  });

  // Advance backoff state only on a successful dispatch. A transport
  // failure means the next event should try again immediately, not be
  // suppressed by the "we just fired" cooldown.
  if (result.outcome === 'sent') {
    await markRuleFired(rule.id, plan.patch);
  }
}

// ─── Bus subscription (auto-start via module import) ───────────────────────
//
// Importing this module wires the dispatcher onto the event bus. Callers
// that want explicit lifetime control can use `attach`/`detach` instead.

let busUnsub: (() => void) | undefined;

export function attach(opts: DispatchOptions = {}): () => void {
  if (busUnsub) busUnsub();
  const handler: EventHandler = (event) => {
    // Promise is not awaited — emit() is fire-and-forget (see event-bus.ts).
    void handleEvent(event, opts);
  };
  busUnsub = subscribe(handler);
  return () => {
    busUnsub?.();
    busUnsub = undefined;
  };
}

export function detach(): void {
  if (busUnsub) {
    busUnsub();
    busUnsub = undefined;
  }
}

/** Re-exported so the UI can drive the loop without a server round-trip
 *  when a user does a "test destination" from the rule editor. */
export { emit };

/** Test-only helpers; never imported by production code. */
export const __testing = {
  clearRing(): void {
    if (globalThis.__nexusNotifRing) globalThis.__nexusNotifRing.length = 0;
  },
} as const;

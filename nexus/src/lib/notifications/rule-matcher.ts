/**
 * Pure predicate evaluator — decides whether a given `Rule.match`
 * criteria is satisfied by a given `NotificationEvent`. No side
 * effects, no I/O. The dispatcher wires this into the backoff state
 * machine; tests target this directly.
 */

import type {
  ComparisonOp,
  NotificationEvent,
  Rule,
  RuleMatch,
  EventKind,
} from './types.ts';

function compare(a: number, op: ComparisonOp, b: number): boolean {
  switch (op) {
    case '>':  return a > b;
    case '>=': return a >= b;
    case '<':  return a < b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
}

/**
 * Pull the string the rule's `scope` filter should match against.
 * Metric events use their own `scope` field; pushed events use a
 * best-effort look into their payload (node / source / username).
 * Returns '' when the event has no scope-ish field — rules with
 * scope filters treat that as a non-match.
 */
function scopeFor(event: NotificationEvent): string {
  if (event.kind === 'metric.threshold.crossed') return event.scope;
  const p = event.payload;
  if (typeof p.node === 'string') return `node:${p.node}`;
  if (typeof p.source === 'string' && typeof p.id === 'string') {
    return `${p.source}:${p.id}`;
  }
  if (typeof p.username === 'string') return `user:${p.username}`;
  return '';
}

/**
 * True when `event` satisfies every criterion in `match`. Kind
 * mismatch is the fast-path rejection; metric-specific fields are
 * only considered for metric.threshold events.
 */
export function matchesEvent(match: RuleMatch, event: NotificationEvent): boolean {
  if (match.eventKind !== event.kind) return false;

  if (match.scope && match.scope.length > 0) {
    const s = scopeFor(event);
    // Substring match so "node:pve" matches "node:pve-01" by default;
    // operators can use full scopes if they want strict equality.
    if (!s.includes(match.scope)) return false;
  }

  if (event.kind === 'metric.threshold.crossed') {
    if (match.metric && match.metric !== event.metric) return false;
    if (match.op !== undefined && match.threshold !== undefined) {
      if (!compare(event.value, match.op, match.threshold)) return false;
    }
  }

  return true;
}

/**
 * Walk a rule set and return every rule whose predicate the event
 * satisfies. Disabled rules are excluded here so downstream
 * dispatchers don't have to know about the flag.
 */
export function rulesForEvent(
  rules: readonly Rule[],
  event: NotificationEvent,
): Rule[] {
  return rules.filter((r) => r.enabled && matchesEvent(r.match, event));
}

/**
 * Build the template context for a given event. Exposed so the UI can
 * render a preview of what keys are available, and so the dispatcher
 * and the test suite agree on the shape.
 */
export function contextFor(
  event: NotificationEvent,
): Record<string, string | number | boolean | null | undefined> {
  const base: Record<string, string | number | boolean | null | undefined> = {
    kind: event.kind,
    at: new Date(event.at).toISOString(),
  };
  if (event.kind === 'metric.threshold.crossed') {
    return { ...base, metric: event.metric, value: event.value, scope: event.scope };
  }
  // Pushed event: merge the payload (values already restricted to
  // JSON-ish scalars at the type level).
  return { ...base, ...event.payload };
}

/** Re-exported so the UI can offer a dropdown of known kinds. */
export type { EventKind };

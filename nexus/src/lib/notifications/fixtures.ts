/**
 * Synthetic event fixtures for the rule-editor template preview.
 *
 * Each entry is a plausible payload for its kind, using the same field
 * names the real emitters write. That means the live preview shows the
 * exact keys an operator can reference (`{{username}}`, `{{reason}}`,
 * `{{metric}}`, …) — typos in the template reveal themselves
 * immediately rather than at 3am when the alert fires.
 *
 * Shared between client (preview) + server code paths — it's all
 * JSON-safe; no React, no I/O.
 */

import type { EventKind, NotificationEvent } from './types.ts';

const AT_FIXED = Date.parse('2026-04-18T12:34:56.000Z');

/**
 * Return a plausible event of the given kind with fully-populated
 * payload fields. Template authors can reference any key shown here
 * and the preview will render it.
 */
export function fixtureEvent(kind: EventKind): NotificationEvent {
  switch (kind) {
    case 'pve.renewal.failed':
      return {
        kind,
        at: AT_FIXED,
        payload: {
          username: 'root@pam',
          reason: 'PVE ticket renewal failed: 401 Unauthorized',
        },
      };
    case 'permission.probe.error':
      return {
        kind,
        at: AT_FIXED,
        payload: {
          probeKind: 'http_5xx',
          username: 'ops@pve',
          path: '/nodes/pve-01',
          extra: 'status=503',
        },
      };
    case 'exec.audit.write.failed':
      return {
        kind,
        at: AT_FIXED,
        payload: {
          endpoint: 'scripts.run',
          username: 'root@pam',
          reason: 'ENOSPC: no space left on device',
        },
      };
    case 'scheduler.fire.failed':
      return {
        kind,
        at: AT_FIXED,
        payload: {
          source: 'chains',
          id: '01HM0Z9K…',
          reason: 'Script URL no longer reachable: 404',
        },
      };
    case 'scheduler.auto.disabled':
      return {
        kind,
        at: AT_FIXED,
        payload: {
          source: 'chains',
          id: '01HM0Z9K…',
          failures: 5,
        },
      };
    case 'session.store.fallback':
      return {
        kind,
        at: AT_FIXED,
        payload: {
          consecutiveErrors: 3,
        },
      };
    case 'metric.threshold.crossed':
      return {
        kind,
        at: AT_FIXED,
        metric: 'node.cpu.max',
        value: 0.92,
        scope: 'node:pve-01',
      };
  }
}

/**
 * Human-friendly kind labels + categorisation for the rule-editor
 * dropdown. Operations events and metric thresholds live in separate
 * <optgroup>s because they mean different things at 3am.
 */
export const KIND_LABELS: Record<EventKind, string> = {
  'pve.renewal.failed':      'PVE ticket renewal failed',
  'permission.probe.error':  'Permission probe error (not auth denial)',
  'exec.audit.write.failed': 'Exec audit log write failed',
  'scheduler.fire.failed':   'Scheduled job fire failed',
  'scheduler.auto.disabled': 'Scheduled job auto-disabled (5 fails)',
  'session.store.fallback':  'Redis session store → memory fallback',
  'metric.threshold.crossed': 'Metric threshold crossed',
};

export const KIND_GROUPS: ReadonlyArray<{
  label: string;
  kinds: ReadonlyArray<EventKind>;
}> = [
  {
    label: 'Operational incidents',
    kinds: [
      'pve.renewal.failed',
      'permission.probe.error',
      'exec.audit.write.failed',
      'scheduler.fire.failed',
      'scheduler.auto.disabled',
      'session.store.fallback',
    ],
  },
  {
    label: 'Metric thresholds (polled)',
    kinds: ['metric.threshold.crossed'],
  },
];

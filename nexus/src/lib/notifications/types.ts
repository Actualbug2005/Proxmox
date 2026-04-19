/**
 * Notification engine — shared type surface.
 *
 * Three discriminated unions live here:
 *
 *   NotificationEvent  — what the rule matcher evaluates against. Event-
 *                        push paths (existing `event=*` log sites) emit
 *                        one of these directly; the poll source maps
 *                        cluster-pressure snapshots to `metric.threshold`
 *                        variants.
 *
 *   DestinationKind    — which transport the dispatcher uses. Each has
 *                        its own shape; the union keeps credential
 *                        validation honest (Discord needs a webhook URL
 *                        only, webhook needs URL + optional HMAC secret,
 *                        ntfy needs topic + optional Basic auth).
 *
 *   Rule               — predicate over events + backoff state. One
 *                        record per rule; cadence state (`consecutiveFires`,
 *                        `nextEligibleAt`) is mutated on fire / clear.
 *
 * All three are persisted to ${NEXUS_DATA_DIR}/notifications.json. The
 * file is the single source of truth; the engine reads + writes through
 * `store.ts` which owns the mutex + atomic-rename pattern.
 */

import type { Branded } from '@/types/brands';

// ─── IDs ────────────────────────────────────────────────────────────────────
// Branded so a rule's `destinationId` field can only be assigned from a
// parsed destination ID — makes "you passed the rule's id where a
// destination's id was wanted" a compile error.

declare const __destId: unique symbol;
declare const __ruleId: unique symbol;

export type DestinationId = string & { readonly [__destId]: 'DestinationId' };
export type RuleId = string & { readonly [__ruleId]: 'RuleId' };

export function isDestinationId(s: string): s is DestinationId {
  return /^dest_[0-9a-f-]{36}$/.test(s);
}
export function isRuleId(s: string): s is RuleId {
  return /^rule_[0-9a-f-]{36}$/.test(s);
}

// ─── Events ─────────────────────────────────────────────────────────────────

/**
 * A pushed event — emitted directly from ops code paths that already
 * log structured `event=*` lines, without an intermediate poll pass.
 */
export interface PushedEvent {
  kind:
    | 'pve.renewal.failed'
    | 'exec.audit.write.failed'
    | 'scheduler.fire.failed'
    | 'scheduler.auto.disabled'
    | 'session.store.fallback'
    | 'permission.probe.error'
    /** DRS dry-run: planner would migrate but mode=dry-run, no move executed. */
    | 'drs.would.migrate'
    /** DRS live: migration executed successfully. */
    | 'drs.migrated'
    /** DRS live: migration attempt was refused by PVE or errored mid-flight. */
    | 'drs.migration.failed'
    /** Guest-agent probe (5.2) — a filesystem crossed the disk-pressure threshold. */
    | 'guest.disk.filling'
    /** Guest-agent probe (5.2) — agent has been unreachable across multiple polls. */
    | 'guest.agent.unreachable'
    /** Auto-update — release probe saw a newer tag than the running version. */
    | 'nexus.update.available'
    /** Auto-update — unattended installer triggered successfully. */
    | 'nexus.update.installed'
    /** Auto-update — unattended install refused by a safety rail (active jobs,
     *  DRS migrations, consoles, or the 60-min floor). Release is still
     *  available, just not applied this tick. */
    | 'nexus.update.deferred'
    /** Auto-update — installer returned non-zero. Operator review required. */
    | 'nexus.update.failed';
  at: number;
  /** Free-form structured payload; rule matcher reads specific keys by kind. */
  payload: Record<string, string | number | boolean | null | undefined>;
  /**
   * Internal marker — true for synthetic "cleared" events emitted by the
   * poll-source or resolve-sweep. The dispatcher propagates this to
   * `DispatchPayload.resolved` so transports render distinctively
   * (Discord embed colour, ntfy emoji, email subject, webhook body).
   * Never set by user-facing emit sites.
   */
  __resolve?: true;
}

/**
 * A polled metric event — produced by the pressure-poll source. Distinct
 * from PushedEvent so rules can opt-in to metric thresholds without
 * matching ops incidents by accident.
 */
export interface MetricEvent {
  kind: 'metric.threshold.crossed';
  at: number;
  /** Dotted metric name, e.g. `cpu.node.max`, `mem.pressure.avg`, `guests.failing`. */
  metric: string;
  /** Scalar value at observation time. */
  value: number;
  /** Optional resource scope — `node:pve`, `guest:100`, `cluster` for cluster-wide. */
  scope: string;
  /**
   * Internal marker — true for synthetic "cleared" events emitted when a
   * metric rule's predicate stops matching. See PushedEvent.__resolve.
   */
  __resolve?: true;
}

export type NotificationEvent = PushedEvent | MetricEvent;

/** Every event-kind literal, exported for UI pickers and rule matcher. */
export const EVENT_KINDS = [
  'pve.renewal.failed',
  'exec.audit.write.failed',
  'scheduler.fire.failed',
  'scheduler.auto.disabled',
  'session.store.fallback',
  'permission.probe.error',
  'drs.would.migrate',
  'drs.migrated',
  'drs.migration.failed',
  'guest.disk.filling',
  'guest.agent.unreachable',
  'nexus.update.available',
  'nexus.update.installed',
  'nexus.update.deferred',
  'nexus.update.failed',
  'metric.threshold.crossed',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Canonical dotted-hierarchy metric names emitted by the polling
 * source. Lives here (rather than in `poll-source.ts`) so client
 * bundles — which need the list for rule-editor dropdowns — can
 * import it without pulling in the server-only fs/store chain.
 * Keep in sync with `computeMetrics()` in `poll-source.ts`.
 */
export const METRIC_NAMES = [
  'cluster.cpu.avg',
  'cluster.mem.avg',
  'node.cpu.max',
  'node.loadavg.per_core',
  'guests.failing.count',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

// ─── Destinations ───────────────────────────────────────────────────────────

export interface WebhookDestination {
  kind: 'webhook';
  /** Target URL. POSTed with `application/json`. */
  url: string;
  /**
   * Optional HMAC-SHA-256 secret. When present, the dispatcher sends an
   * `X-Nexus-Signature: sha256=<hex>` header so the receiver can verify
   * the payload originated from this Nexus instance.
   */
  hmacSecret?: string;
}

export interface NtfyDestination {
  kind: 'ntfy';
  /** Full topic URL, e.g. `https://ntfy.sh/nexus-alerts` or a self-hosted variant. */
  topicUrl: string;
  /**
   * Optional Basic-auth header value (`username:password`). ntfy's ACL
   * mode uses HTTP Basic auth — we store the raw pair encrypted and emit
   * the Base64 header at dispatch time, not on disk.
   */
  basicAuth?: string;
}

export interface DiscordDestination {
  kind: 'discord';
  /** Discord webhook URL (starts `https://discord.com/api/webhooks/...`). */
  webhookUrl: string;
}

/**
 * SMTP-delivered email. Ports are restricted to the modern TLS variants
 * — 465 (implicit TLS) or 587 (STARTTLS) — because plain port 25 without
 * auth/encryption is indefensible in 2026. `tlsInsecure` is the escape
 * hatch for homelab SMTP with self-signed certs; it disables cert
 * verification but does NOT downgrade to plaintext.
 *
 * Recipients are a static comma-separated list authored at destination
 * creation time; no template-driven addressing (keeps the templating
 * grammar logic-less).
 */
export interface EmailDestination {
  kind: 'email';
  host: string;
  /** One of the two TLS ports — validator rejects anything else. */
  port: 465 | 587;
  /**
   * True for port 465 (implicit TLS from connect). False for port 587
   * (plaintext LOGIN then STARTTLS). Must match the port — 465 without
   * `secure` or 587 with `secure` are both busted SMTP clients.
   */
  secure: boolean;
  /**
   * Opt-in to skipping TLS cert validation. Only for self-hosted /
   * self-signed-cert LAN SMTP. Never disables encryption, only verification.
   */
  tlsInsecure?: boolean;
  username: string;
  password: string;
  /** RFC 5322 "From:" address. */
  from: string;
  /** Non-empty list of RFC 5322 "To:" addresses. */
  to: string[];
}

export type DestinationConfig =
  | WebhookDestination
  | NtfyDestination
  | DiscordDestination
  | EmailDestination;
export type DestinationKind = DestinationConfig['kind'];

/**
 * Persisted shape — `config` is the discriminated union above, but every
 * secret field (`hmacSecret`, `basicAuth`, the webhook/topic URLs) is
 * encrypted at rest (AES-GCM, key derived from JWT_SECRET via HKDF).
 * On read, `store.ts` decrypts back to the union before handing to
 * consumers. The `encryptedBlob` shape lives in `crypto.ts`.
 */
export interface Destination {
  id: DestinationId;
  name: string;
  /**
   * Kept in plain text so the UI can filter/list without decryption
   * and the rule matcher can cheaply locate "all ntfy destinations"
   * without touching the crypto path.
   */
  kind: DestinationKind;
  /** Opaque base64 ciphertext envelope — see `crypto.ts` for framing. */
  secretBlob: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

/** Numeric comparison op used by metric-threshold rules. */
export const COMPARISON_OPS = ['>', '>=', '<', '<=', '==', '!='] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

/**
 * Built-in backoff curves. Values are intervals (minutes) between
 * successive fires while the predicate stays matching. The LAST entry
 * is the steady-state cap — `consecutiveFires` beyond the array length
 * keep waiting that interval (we don't "fall off" the curve).
 *
 * Gentle is the out-of-the-box default: 4 notifications in the first
 * hour of sustained alerting, which matches how most ops teams tune
 * their pager in practice.
 */
export const BACKOFF_CURVES = {
  gentle:      [0, 5, 15, 60],
  moderate:    [0, 5, 15, 30, 60],
  aggressive:  [0, 2, 5, 10, 30, 60],
  exponential: [0, 1, 2, 4, 8, 16, 32, 60],
} as const;
export type BuiltInCurveName = keyof typeof BACKOFF_CURVES;

export interface BackoffConfig {
  /** Preset name, or 'custom' to supply `customIntervalsMin`. */
  curve: BuiltInCurveName | 'custom';
  /**
   * Required when curve = 'custom'. Must be non-empty; last value is
   * the steady-state cap. Validated by `store.ts` on create/update.
   */
  customIntervalsMin?: number[];
}

/**
 * Resolve-notification policy — controls whether the dispatcher fires
 * a "resolved" message when a rule's predicate stops matching.
 *   - 'always'     — fire on every clear, even after a single match
 *   - 'multi-fire' — fire only if the rule sent ≥2 notifications in
 *                    the current run (blips don't generate noise)
 *   - 'never'      — silent on resolve; traditional Nagios-style
 *
 * Default is 'multi-fire' — you asked for option (c).
 */
export type ResolvePolicy = 'always' | 'multi-fire' | 'never';

/**
 * Match criteria — structured JSON, deliberately NOT an expression
 * language. The matcher handles `eventKind` plus the optional metric
 * fields; other payload keys appear only as template variables.
 */
export interface RuleMatch {
  eventKind: EventKind;
  /** For metric.threshold.crossed only. Ignored on other kinds. */
  metric?: string;
  op?: ComparisonOp;
  threshold?: number;
  /**
   * Optional scope filter — substring-matched against the event's
   * `scope` (metric) or `payload.node` / `payload.source` (pushed).
   * Empty = match any scope.
   */
  scope?: string;
}

/**
 * Rule — a persisted predicate + a destination + a template + backoff
 * state. The state fields are mutated in-place by the dispatcher every
 * fire; consumers that only want the definition should deep-copy first.
 */
export interface Rule {
  id: RuleId;
  name: string;
  enabled: boolean;
  match: RuleMatch;
  destinationId: DestinationId;
  /**
   * Mustache-ish template. Supports `{{key}}` lookups only — no
   * conditionals, loops, or partials. Lookups are drawn from the event
   * payload; unknown keys render as the empty string.
   */
  messageTemplate: string;
  /**
   * Optional message template used when the rule clears (event.__resolve
   * is true). Falls back to `messageTemplate` when unset. Resolve
   * templates may reference `{{firingFor}}` in addition to the usual
   * event-payload keys.
   */
  resolveMessageTemplate?: string;
  /** Optional fixed-string title prefix for destinations that want one. */
  title?: string;

  /**
   * Optional per-rule backoff override. `undefined` means use the system
   * default (Gentle curve). A rule can opt into aggressive paging for a
   * specific alert without affecting the rest of the rule set.
   */
  backoff?: BackoffConfig;
  /**
   * Optional per-rule resolve policy. `undefined` = 'multi-fire' default.
   */
  resolvePolicy?: ResolvePolicy;

  // ─── backoff state ────────────────────────────────────────────────────────
  /** When the predicate first matched in the current "run" (cleared → matched). */
  firstMatchAt?: number;
  /** When the dispatcher last fired for this rule. */
  lastFireAt?: number;
  /**
   * Dispatcher won't fire again until `at >= nextEligibleAt`. Bumped
   * on each fire according to the backoff schedule in `backoff.ts`.
   */
  nextEligibleAt?: number;
  /** How many times this "run" has fired — drives the backoff index. */
  consecutiveFires: number;
  /** When the predicate last stopped matching (triggers the "resolved" note). */
  clearedAt?: number;

  createdAt: number;
  updatedAt: number;
}

// ─── Dispatch records ──────────────────────────────────────────────────────
//
// Ring-buffer of recent attempts, exposed to the UI for the "last fired"
// column on each rule. Not persisted — on process restart the buffer
// resets; rule state (`lastFireAt` etc.) is the durable record.

export interface DispatchRecord {
  ruleId: RuleId;
  destinationId: DestinationId;
  at: number;
  outcome: 'sent' | 'failed' | 'skipped';
  reason?: string;
  /** For `sent`: HTTP status. For `failed`: may be undefined (transport error). */
  status?: number;
}

export type { Branded };

/**
 * Input validators for the notifications CRUD routes.
 *
 * These sit at the trust boundary — every field read here came from a
 * browser-delivered JSON body. We refuse anything that doesn't match
 * the expected shape rather than best-effort coercing; downstream
 * modules (store, dispatcher, destinations) then trust their inputs.
 *
 * Validators return an `Ok<T>` or `{ error: string }` so routes can
 * uniformly map to 400 responses without ad-hoc throw handling.
 */

import {
  COMPARISON_OPS,
  EVENT_KINDS,
  type ComparisonOp,
  type DestinationConfig,
  type EventKind,
  type ResolvePolicy,
  type RuleMatch,
  type BackoffConfig,
} from '@/lib/notifications/types';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ─── Primitives ────────────────────────────────────────────────────────────

function str(v: unknown, field: string, max = 1024): Result<string> {
  if (typeof v !== 'string') return { ok: false, error: `${field} must be a string` };
  if (v.length === 0) return { ok: false, error: `${field} must not be empty` };
  if (v.length > max) return { ok: false, error: `${field} exceeds ${max} chars` };
  return { ok: true, value: v };
}

function httpsUrl(v: unknown, field: string): Result<string> {
  const asStr = str(v, field, 2048);
  if (!asStr.ok) return asStr;
  let parsed: URL;
  try {
    parsed = new URL(asStr.value);
  } catch {
    return { ok: false, error: `${field} is not a valid URL` };
  }
  // Require https outright. Webhook receivers on plain HTTP leak the
  // signature header + body to any LAN sniffer; ntfy + Discord are
  // HTTPS-only upstream anyway.
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `${field} must use https:// (not ${parsed.protocol})` };
  }
  return { ok: true, value: asStr.value };
}

function optionalStr(v: unknown, field: string, max = 1024): Result<string | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  return str(v, field, max);
}

function bool(v: unknown, field: string): Result<boolean> {
  if (typeof v !== 'boolean') return { ok: false, error: `${field} must be a boolean` };
  return { ok: true, value: v };
}

function finiteNumber(v: unknown, field: string): Result<number> {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { ok: false, error: `${field} must be a finite number` };
  }
  return { ok: true, value: v };
}

// ─── Destinations ──────────────────────────────────────────────────────────

export interface DestinationInput {
  name: string;
  config: DestinationConfig;
}

export function parseDestinationInput(raw: unknown): Result<DestinationInput> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  const name = str(obj.name, 'name', 128);
  if (!name.ok) return name;

  const cfgRaw = obj.config;
  if (!cfgRaw || typeof cfgRaw !== 'object' || Array.isArray(cfgRaw)) {
    return { ok: false, error: 'config must be an object' };
  }
  const cfgObj = cfgRaw as Record<string, unknown>;
  const kind = cfgObj.kind;

  let config: DestinationConfig;
  if (kind === 'webhook') {
    const url = httpsUrl(cfgObj.url, 'config.url');
    if (!url.ok) return url;
    const hmac = optionalStr(cfgObj.hmacSecret, 'config.hmacSecret', 512);
    if (!hmac.ok) return hmac;
    config = { kind: 'webhook', url: url.value, hmacSecret: hmac.value };
  } else if (kind === 'ntfy') {
    const topicUrl = httpsUrl(cfgObj.topicUrl, 'config.topicUrl');
    if (!topicUrl.ok) return topicUrl;
    const basicAuth = optionalStr(cfgObj.basicAuth, 'config.basicAuth', 512);
    if (!basicAuth.ok) return basicAuth;
    if (basicAuth.value && !basicAuth.value.includes(':')) {
      return { ok: false, error: 'config.basicAuth must be "user:password"' };
    }
    config = { kind: 'ntfy', topicUrl: topicUrl.value, basicAuth: basicAuth.value };
  } else if (kind === 'discord') {
    const webhookUrl = httpsUrl(cfgObj.webhookUrl, 'config.webhookUrl');
    if (!webhookUrl.ok) return webhookUrl;
    // Defence-in-depth: Discord's webhook URLs always contain this path
    // segment. A typo'd URL (e.g. to an unrelated internal tool) would
    // miss it, so refusing the request beats silently 404-ing at fire
    // time.
    if (!webhookUrl.value.includes('/api/webhooks/')) {
      return { ok: false, error: 'config.webhookUrl does not look like a Discord webhook' };
    }
    config = { kind: 'discord', webhookUrl: webhookUrl.value };
  } else {
    return { ok: false, error: `unknown destination kind: ${String(kind)}` };
  }

  return { ok: true, value: { name: name.value, config } };
}

// Partial update — name and/or config.
export type DestinationPatchInput = Partial<DestinationInput>;
export function parseDestinationPatch(raw: unknown): Result<DestinationPatchInput> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  const out: DestinationPatchInput = {};
  if (obj.name !== undefined) {
    const name = str(obj.name, 'name', 128);
    if (!name.ok) return name;
    out.name = name.value;
  }
  if (obj.config !== undefined) {
    const full = parseDestinationInput({ name: 'placeholder', config: obj.config });
    if (!full.ok) return full;
    out.config = full.value.config;
  }
  return { ok: true, value: out };
}

// ─── Rules ─────────────────────────────────────────────────────────────────

export interface RuleInput {
  name: string;
  enabled: boolean;
  match: RuleMatch;
  destinationId: string;
  messageTemplate: string;
  title?: string;
  backoff?: BackoffConfig;
  resolvePolicy?: ResolvePolicy;
}

function parseMatch(raw: unknown): Result<RuleMatch> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'match must be an object' };
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.eventKind !== 'string' || !(EVENT_KINDS as readonly string[]).includes(m.eventKind)) {
    return { ok: false, error: `match.eventKind must be one of: ${EVENT_KINDS.join(', ')}` };
  }
  const out: RuleMatch = { eventKind: m.eventKind as EventKind };
  if (m.scope !== undefined) {
    const s = optionalStr(m.scope, 'match.scope', 128);
    if (!s.ok) return s;
    out.scope = s.value;
  }
  // Metric fields only valid on metric.threshold.crossed; silently drop
  // them for other kinds rather than surprising the operator with a 400.
  if (out.eventKind === 'metric.threshold.crossed') {
    if (m.metric !== undefined) {
      const metric = optionalStr(m.metric, 'match.metric', 128);
      if (!metric.ok) return metric;
      out.metric = metric.value;
    }
    if (m.op !== undefined) {
      if (typeof m.op !== 'string' || !(COMPARISON_OPS as readonly string[]).includes(m.op)) {
        return { ok: false, error: `match.op must be one of: ${COMPARISON_OPS.join(', ')}` };
      }
      out.op = m.op as ComparisonOp;
    }
    if (m.threshold !== undefined) {
      const t = finiteNumber(m.threshold, 'match.threshold');
      if (!t.ok) return t;
      out.threshold = t.value;
    }
  }
  return { ok: true, value: out };
}

function parseBackoff(raw: unknown): Result<BackoffConfig | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'backoff must be an object' };
  }
  const b = raw as Record<string, unknown>;
  const curveRaw = b.curve;
  const validCurves = ['gentle', 'moderate', 'aggressive', 'exponential', 'custom'];
  if (typeof curveRaw !== 'string' || !validCurves.includes(curveRaw)) {
    return { ok: false, error: `backoff.curve must be one of: ${validCurves.join(', ')}` };
  }
  const out: BackoffConfig = { curve: curveRaw as BackoffConfig['curve'] };
  if (curveRaw === 'custom') {
    if (!Array.isArray(b.customIntervalsMin) || b.customIntervalsMin.length === 0) {
      return { ok: false, error: 'backoff.customIntervalsMin must be a non-empty array when curve=custom' };
    }
    const ints: number[] = [];
    for (const n of b.customIntervalsMin) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 24 * 60) {
        return { ok: false, error: 'backoff.customIntervalsMin entries must be finite minutes in [0, 1440]' };
      }
      ints.push(Math.round(n));
    }
    out.customIntervalsMin = ints;
  }
  return { ok: true, value: out };
}

function parseResolve(raw: unknown): Result<ResolvePolicy | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (raw !== 'always' && raw !== 'multi-fire' && raw !== 'never') {
    return { ok: false, error: 'resolvePolicy must be always|multi-fire|never' };
  }
  return { ok: true, value: raw };
}

export function parseRuleInput(raw: unknown): Result<RuleInput> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  const name = str(obj.name, 'name', 128);
  if (!name.ok) return name;
  const destinationId = str(obj.destinationId, 'destinationId', 64);
  if (!destinationId.ok) return destinationId;
  // Templates can be long enough to carry a useful message + several
  // interpolated keys; 4 KB is generous without inviting abuse.
  const messageTemplate = str(obj.messageTemplate, 'messageTemplate', 4096);
  if (!messageTemplate.ok) return messageTemplate;

  const match = parseMatch(obj.match);
  if (!match.ok) return match;

  const enabled = obj.enabled === undefined ? { ok: true as const, value: true } : bool(obj.enabled, 'enabled');
  if (!enabled.ok) return enabled;

  const title = optionalStr(obj.title, 'title', 128);
  if (!title.ok) return title;

  const backoff = parseBackoff(obj.backoff);
  if (!backoff.ok) return backoff;

  const resolvePolicy = parseResolve(obj.resolvePolicy);
  if (!resolvePolicy.ok) return resolvePolicy;

  return {
    ok: true,
    value: {
      name: name.value,
      enabled: enabled.value,
      match: match.value,
      destinationId: destinationId.value,
      messageTemplate: messageTemplate.value,
      title: title.value,
      backoff: backoff.value,
      resolvePolicy: resolvePolicy.value,
    },
  };
}

// For PATCH — every field optional.
export type RulePatchInput = Partial<RuleInput>;
export function parseRulePatch(raw: unknown): Result<RulePatchInput> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  const out: RulePatchInput = {};
  if (obj.name !== undefined) {
    const r = str(obj.name, 'name', 128);
    if (!r.ok) return r;
    out.name = r.value;
  }
  if (obj.enabled !== undefined) {
    const r = bool(obj.enabled, 'enabled');
    if (!r.ok) return r;
    out.enabled = r.value;
  }
  if (obj.match !== undefined) {
    const r = parseMatch(obj.match);
    if (!r.ok) return r;
    out.match = r.value;
  }
  if (obj.destinationId !== undefined) {
    const r = str(obj.destinationId, 'destinationId', 64);
    if (!r.ok) return r;
    out.destinationId = r.value;
  }
  if (obj.messageTemplate !== undefined) {
    const r = str(obj.messageTemplate, 'messageTemplate', 4096);
    if (!r.ok) return r;
    out.messageTemplate = r.value;
  }
  if (obj.title !== undefined) {
    const r = optionalStr(obj.title, 'title', 128);
    if (!r.ok) return r;
    out.title = r.value;
  }
  if (obj.backoff !== undefined) {
    const r = parseBackoff(obj.backoff);
    if (!r.ok) return r;
    out.backoff = r.value;
  }
  if (obj.resolvePolicy !== undefined) {
    const r = parseResolve(obj.resolvePolicy);
    if (!r.ok) return r;
    out.resolvePolicy = r.value;
  }
  return { ok: true, value: out };
}

/**
 * Persistent store for destinations + rules.
 *
 * Storage: single JSON file at ${NEXUS_DATA_DIR}/notifications.json,
 * schema-versioned. Mirrors the chains-store / scheduled-jobs-store
 * pattern — serialised mutex + atomic-rename on every write — so a
 * crash mid-save doesn't leave a truncated definitions file.
 *
 * Shapes:
 *   - `Destination.secretBlob` is the AES-GCM ciphertext from
 *     `crypto.ts` of a JSON-serialised DestinationConfig. The store
 *     keeps only the blob + the `kind` + human-readable name; callers
 *     that need the plaintext config call `decryptDestination()`.
 *   - `Rule` is persisted whole including backoff state. The
 *     dispatcher mutates `lastFireAt` / `nextEligibleAt` /
 *     `consecutiveFires` / `clearedAt` / `firstMatchAt` directly via
 *     `markFired()` / `markCleared()` so the state survives restarts.
 */

import { promises as fsp } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { decryptSecret, encryptSecret } from './crypto.ts';
import type {
  BackoffConfig,
  Destination,
  DestinationConfig,
  DestinationId,
  ResolvePolicy,
  Rule,
  RuleId,
  RuleMatch,
} from './types.ts';

function resolveDataDir(): string {
  const envDir = process.env.NEXUS_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(tmpdir(), 'nexus-data');
}

const DATA_DIR = resolveDataDir();
const FILE = join(DATA_DIR, 'notifications.json');

mkdirSync(DATA_DIR, { recursive: true });

interface FileShape {
  version: 1;
  destinations: Destination[];
  rules: Rule[];
}

const EMPTY: FileShape = { version: 1, destinations: [], rules: [] };

async function readFile(): Promise<FileShape> {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as FileShape;
    if (parsed.version !== 1) return EMPTY;
    if (!Array.isArray(parsed.destinations) || !Array.isArray(parsed.rules)) return EMPTY;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw err;
  }
}

async function writeFile(state: FileShape): Promise<void> {
  // Atomic rename so a mid-write crash can't leave a half-written
  // definitions file — either the old content or the new, never a
  // truncated mix.
  const tmp = `${FILE}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fsp.rename(tmp, FILE);
}

// ─── Mutex ──────────────────────────────────────────────────────────────────
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

// ─── Destinations ──────────────────────────────────────────────────────────

export interface CreateDestinationInput {
  name: string;
  config: DestinationConfig;
}

export async function listDestinations(): Promise<Destination[]> {
  return serialize(async () => (await readFile()).destinations);
}

export async function getDestination(id: DestinationId): Promise<Destination | null> {
  return serialize(async () => {
    const state = await readFile();
    return state.destinations.find((d) => d.id === id) ?? null;
  });
}

export async function createDestination(
  input: CreateDestinationInput,
): Promise<Destination> {
  return serialize(async () => {
    const state = await readFile();
    const now = Date.now();
    const d: Destination = {
      id: `dest_${randomUUID()}` as DestinationId,
      name: input.name,
      kind: input.config.kind,
      secretBlob: encryptSecret(input.config),
      createdAt: now,
      updatedAt: now,
    };
    state.destinations.push(d);
    await writeFile(state);
    return d;
  });
}

export async function updateDestination(
  id: DestinationId,
  patch: { name?: string; config?: DestinationConfig },
): Promise<Destination | null> {
  return serialize(async () => {
    const state = await readFile();
    const idx = state.destinations.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    const prev = state.destinations[idx];
    const merged: Destination = {
      ...prev,
      name: patch.name ?? prev.name,
      kind: patch.config?.kind ?? prev.kind,
      secretBlob: patch.config ? encryptSecret(patch.config) : prev.secretBlob,
      updatedAt: Date.now(),
    };
    state.destinations[idx] = merged;
    await writeFile(state);
    return merged;
  });
}

export async function removeDestination(id: DestinationId): Promise<boolean> {
  return serialize(async () => {
    const state = await readFile();
    const before = state.destinations.length;
    state.destinations = state.destinations.filter((d) => d.id !== id);
    // Also drop any rules that referenced this destination — leaving
    // them orphaned would silently break the dispatcher.
    state.rules = state.rules.filter((r) => r.destinationId !== id);
    if (state.destinations.length === before) return false;
    await writeFile(state);
    return true;
  });
}

/**
 * Decrypt a destination's secret blob and return the plaintext config.
 * Throws on tamper / missing key — callers should treat that as
 * "destination unreachable" and surface to the operator; do NOT
 * swallow and fall back to a partial config.
 */
export function decryptDestination(d: Destination): DestinationConfig {
  const plain = decryptSecret(d.secretBlob);
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) {
    throw new Error(`Destination ${d.id} has a corrupt secret blob`);
  }
  const obj = plain as { kind?: unknown };
  if (obj.kind !== d.kind) {
    // If the encrypted `kind` doesn't match the plaintext `kind`, someone
    // has been mucking with the file — the store owns the invariant.
    throw new Error(`Destination ${d.id} kind mismatch (plaintext vs envelope)`);
  }
  return plain as DestinationConfig;
}

// ─── Rules ─────────────────────────────────────────────────────────────────

export interface CreateRuleInput {
  name: string;
  enabled?: boolean;
  match: RuleMatch;
  destinationId: DestinationId;
  messageTemplate: string;
  /** Optional template used when the rule clears; falls back to messageTemplate. */
  resolveMessageTemplate?: string;
  title?: string;
  /** Optional per-rule backoff override; falls back to system default. */
  backoff?: BackoffConfig;
  /** Optional per-rule resolve policy; 'multi-fire' when unset. */
  resolvePolicy?: ResolvePolicy;
}

export async function listRules(): Promise<Rule[]> {
  return serialize(async () => (await readFile()).rules);
}

export async function getRule(id: RuleId): Promise<Rule | null> {
  return serialize(async () => {
    const state = await readFile();
    return state.rules.find((r) => r.id === id) ?? null;
  });
}

export async function createRule(input: CreateRuleInput): Promise<Rule> {
  return serialize(async () => {
    const state = await readFile();
    // Refuse to persist a rule pointing at a destination that doesn't
    // exist — catches typos and cross-file desync early.
    if (!state.destinations.some((d) => d.id === input.destinationId)) {
      throw new Error(`Destination ${input.destinationId} does not exist`);
    }
    const now = Date.now();
    const r: Rule = {
      id: `rule_${randomUUID()}` as RuleId,
      name: input.name,
      enabled: input.enabled ?? true,
      match: input.match,
      destinationId: input.destinationId,
      messageTemplate: input.messageTemplate,
      resolveMessageTemplate: input.resolveMessageTemplate,
      title: input.title,
      backoff: input.backoff,
      resolvePolicy: input.resolvePolicy,
      consecutiveFires: 0,
      createdAt: now,
      updatedAt: now,
    };
    state.rules.push(r);
    await writeFile(state);
    return r;
  });
}

export async function updateRule(
  id: RuleId,
  patch: Partial<Omit<Rule, 'id' | 'createdAt'>>,
): Promise<Rule | null> {
  return serialize(async () => {
    const state = await readFile();
    const idx = state.rules.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const prev = state.rules[idx];
    const merged: Rule = {
      ...prev,
      ...patch,
      id: prev.id,
      createdAt: prev.createdAt,
      updatedAt: Date.now(),
    };
    state.rules[idx] = merged;
    await writeFile(state);
    return merged;
  });
}

export async function removeRule(id: RuleId): Promise<boolean> {
  return serialize(async () => {
    const state = await readFile();
    const before = state.rules.length;
    state.rules = state.rules.filter((r) => r.id !== id);
    if (state.rules.length === before) return false;
    await writeFile(state);
    return true;
  });
}

/**
 * Atomically update a rule's backoff state after a dispatch. Separate
 * entry from `updateRule` so the dispatcher can't accidentally stomp
 * on user-configured fields, and the mutex is the only serialization
 * point (no TOCTOU between "read rule" and "save state").
 */
export async function markRuleFired(
  id: RuleId,
  patch: Pick<Rule, 'lastFireAt' | 'nextEligibleAt' | 'consecutiveFires'> & {
    firstMatchAt?: number;
  },
): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    const idx = state.rules.findIndex((r) => r.id === id);
    if (idx === -1) return;
    state.rules[idx] = {
      ...state.rules[idx],
      lastFireAt: patch.lastFireAt,
      nextEligibleAt: patch.nextEligibleAt,
      consecutiveFires: patch.consecutiveFires,
      firstMatchAt: patch.firstMatchAt ?? state.rules[idx].firstMatchAt,
      clearedAt: undefined,
      updatedAt: Date.now(),
    };
    await writeFile(state);
  });
}

/** Counterpart to `markRuleFired` — resets backoff on "predicate cleared". */
export async function markRuleCleared(id: RuleId, at: number): Promise<void> {
  await serialize(async () => {
    const state = await readFile();
    const idx = state.rules.findIndex((r) => r.id === id);
    if (idx === -1) return;
    state.rules[idx] = {
      ...state.rules[idx],
      consecutiveFires: 0,
      nextEligibleAt: undefined,
      firstMatchAt: undefined,
      clearedAt: at,
      updatedAt: Date.now(),
    };
    await writeFile(state);
  });
}

// Test helpers — not part of the public API; the `__` prefix signals that.
export const __testing = {
  dataPath(): string {
    return FILE;
  },
  async reset(): Promise<void> {
    await serialize(async () => {
      await writeFile(EMPTY);
    });
  },
} as const;

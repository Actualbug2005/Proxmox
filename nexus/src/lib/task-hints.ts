/**
 * Mechanistic hint mapping for known PVE failure shapes.
 *
 * Pure module-level functions — regex literals and string lookups are
 * compiled once per process. Safe to call inside React render paths without
 * useMemo (they don't allocate per call).
 *
 * Add a new entry by:
 *   1. Picking a `HintRule` (taskType-scoped or freeform predicate).
 *   2. Listing it in `RULES` (order matters — first match wins).
 */

export interface TaskHint {
  /** Short human-readable hint (one sentence). */
  message: string;
  /** Whether the hint represents a likely transient/fixable condition. */
  severity: 'warn' | 'info';
}

/** A task summary the hint engine consumes — duck-typed against PVETask so
 *  callers don't have to construct adapters. */
export interface TaskLike {
  type?: string;
  status?: string;
  exitstatus?: string;
}

interface HintRule {
  /** Optional task-type gate (matches against PVETask.type, e.g. 'aptupdate'). */
  taskType?: string;
  /** Predicate over the combined error/status string. */
  match: (errorText: string) => boolean;
  hint: TaskHint;
}

const APT_EXIT_100 = /\bapt(?:-get)?\b.*\bexit code 100\b/i;
const TERMPROXY_EXIT_1 = /\btermproxy\b.*\bexit code 1\b/i;

const RULES: readonly HintRule[] = [
  {
    taskType: 'aptupdate',
    match: (s) => /\bexit code 100\b/.test(s),
    hint: {
      message: 'apt repo unreachable — check pve-enterprise.list or node DNS',
      severity: 'warn',
    },
  },
  {
    // Catches console/termproxy failures regardless of which task type PVE
    // assigns, since the error string is what discriminates.
    match: (s) => TERMPROXY_EXIT_1.test(s),
    hint: {
      message:
        'Container is stopped or does not exist — start it, or refresh the dashboard to clear deleted resources.',
      severity: 'warn',
    },
  },
  {
    // Generic apt-get failure with exit 100 even outside a typed aptupdate task.
    match: (s) => APT_EXIT_100.test(s),
    hint: {
      message: 'apt repo unreachable — check pve-enterprise.list or node DNS',
      severity: 'warn',
    },
  },
];

/**
 * Resolve a hint for a finished task. Returns null when nothing matches —
 * callers then fall back to the raw badge text.
 */
export function hintForTask(task: TaskLike): TaskHint | null {
  const text = `${task.exitstatus ?? ''} ${task.status ?? ''}`.trim();
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.taskType && task.type !== rule.taskType) continue;
    if (rule.match(text)) return rule.hint;
  }
  return null;
}

/**
 * Resolve a hint for a free-form error string (e.g. a thrown ProxmoxAPIError
 * message from the WS-relay setup). The optional `taskType` lets the caller
 * narrow the search to type-scoped rules.
 */
export function hintForError(message: string, taskType?: string): TaskHint | null {
  if (!message) return null;
  for (const rule of RULES) {
    if (rule.taskType && taskType !== rule.taskType) continue;
    if (rule.match(message)) return rule.hint;
  }
  return null;
}

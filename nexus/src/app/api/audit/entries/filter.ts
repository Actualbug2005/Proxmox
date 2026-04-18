/**
 * Extracted from route.ts so the filter + line-parser are unit-testable
 * without mocking Next.js's request/response objects. The route now
 * delegates to these; nothing in the module touches I/O.
 */
import type { SafeEntry } from '@/lib/exec-audit';

export interface EntryFilter {
  user?: string;
  endpoint?: SafeEntry['endpoint'];
  node?: string;
  sinceMs?: number;
  untilMs?: number;
}

/** True when `entry` satisfies every provided filter criterion. */
export function matches(entry: SafeEntry, f: EntryFilter): boolean {
  if (f.user && entry.user !== f.user) return false;
  if (f.endpoint && entry.endpoint !== f.endpoint) return false;
  if (f.node && entry.node !== f.node) return false;
  if (f.sinceMs !== undefined) {
    const t = Date.parse(entry.ts);
    if (!Number.isNaN(t) && t < f.sinceMs) return false;
  }
  if (f.untilMs !== undefined) {
    const t = Date.parse(entry.ts);
    if (!Number.isNaN(t) && t > f.untilMs) return false;
  }
  return true;
}

/**
 * Parse a full exec.jsonl body newest-first, yield up to `limit` matches,
 * and report the total count of matches seen. Torn writes / blank lines
 * are skipped rather than throwing — a log rotator shouldn't break
 * the reader.
 */
export function selectEntries(
  body: string,
  filter: EntryFilter,
  limit: number,
): { entries: SafeEntry[]; total: number } {
  const lines = body.split('\n');
  const entries: SafeEntry[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let entry: SafeEntry;
    try {
      entry = JSON.parse(line) as SafeEntry;
    } catch {
      continue;
    }
    if (!matches(entry, filter)) continue;
    total += 1;
    if (entries.length < limit) entries.push(entry);
  }
  return { entries, total };
}

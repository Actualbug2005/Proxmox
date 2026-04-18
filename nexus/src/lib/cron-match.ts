/**
 * Minimal cron matcher for the PVE-extended subset emitted by <CronInput>.
 *
 * Why not a library: node-cron et al. pull in a full scheduler; we only need
 * the "does this expression match this Date?" predicate. Keeping the parse
 * local also keeps our grammar explicit — only what we already generate and
 * document is accepted, everything else rejects.
 *
 * Supported grammar (five whitespace-separated fields):
 *
 *   minute hour day-of-month month day-of-week
 *
 *   *                         wildcard
 *   N                         literal
 *   N,M,O                     list
 *   N-M  or  N..M             inclusive range (both syntaxes — PVE uses `..`)
 *   * /N (no space)           step over the full range
 *   N-M/S  or  N..M/S         step inside a range
 *   mon / jan etc.            day-of-week / month name, case-insensitive
 *   mon-fri, mon..fri, etc.   name ranges
 *
 * Day-of-week semantics follow vixie cron: when both dom and dow are
 * restricted, a match on EITHER is sufficient; when only one is restricted
 * it must match; when both are `*` every day qualifies.
 */

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface FieldSpec {
  min: number;
  max: number;
  names?: Record<string, number>;
  /** dow accepts 7 as an alias for 0 (Sunday) per POSIX tradition. */
  allowSeven?: boolean;
}

const SPECS = {
  minute: { min: 0, max: 59 } as FieldSpec,
  hour:   { min: 0, max: 23 } as FieldSpec,
  dom:    { min: 1, max: 31 } as FieldSpec,
  month:  { min: 1, max: 12, names: MONTH_NAMES } as FieldSpec,
  dow:    { min: 0, max: 6, names: DOW_NAMES, allowSeven: true } as FieldSpec,
};

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** True when the raw field is anything other than `*` — drives vixie OR-semantics. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

function resolveToken(token: string, spec: FieldSpec): number {
  const t = token.trim().toLowerCase();
  if (spec.names && Object.prototype.hasOwnProperty.call(spec.names, t)) {
    return spec.names[t];
  }
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || String(n) !== t) {
    throw new Error(`Invalid cron token: ${token}`);
  }
  if (spec.allowSeven && n === 7) return 0;
  if (n < spec.min || n > spec.max) {
    throw new Error(`Out of range: ${token}`);
  }
  return n;
}

function expandPart(part: string, spec: FieldSpec, out: Set<number>): void {
  let step = 1;
  let base = part;
  const slash = part.indexOf('/');
  if (slash !== -1) {
    base = part.slice(0, slash);
    const stepStr = part.slice(slash + 1);
    step = Number.parseInt(stepStr, 10);
    if (!Number.isFinite(step) || step < 1 || String(step) !== stepStr.trim()) {
      throw new Error(`Invalid step: ${part}`);
    }
  }

  let lo: number;
  let hi: number;
  if (base === '' || base === '*') {
    lo = spec.min;
    hi = spec.max;
  } else if (base.includes('..')) {
    const [a, b] = base.split('..');
    lo = resolveToken(a, spec);
    hi = resolveToken(b, spec);
  } else if (base.includes('-') && !spec.names) {
    const [a, b] = base.split('-');
    lo = resolveToken(a, spec);
    hi = resolveToken(b, spec);
  } else if (base.includes('-') && spec.names) {
    // Name ranges like `mon-fri`. Dash is the only separator we allow between
    // names because `..` is already handled above; a minus inside a name
    // never occurs.
    const [a, b] = base.split('-');
    lo = resolveToken(a, spec);
    hi = resolveToken(b, spec);
  } else {
    lo = hi = resolveToken(base, spec);
  }

  if (lo > hi) throw new Error(`Invalid range: ${part}`);
  for (let v = lo; v <= hi; v += step) out.add(v);
}

function expandField(expr: string, spec: FieldSpec): Set<number> {
  const result = new Set<number>();
  for (const p of expr.split(',')) {
    expandPart(p.trim(), spec, result);
  }
  return result;
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected 5 cron fields, got ${parts.length}: ${expr}`);
  }
  return {
    minute: expandField(parts[0], SPECS.minute),
    hour:   expandField(parts[1], SPECS.hour),
    dom:    expandField(parts[2], SPECS.dom),
    month:  expandField(parts[3], SPECS.month),
    dow:    expandField(parts[4], SPECS.dow),
    domRestricted: parts[2].trim() !== '*',
    dowRestricted: parts[4].trim() !== '*',
  };
}

/**
 * Does `date` match `expr`? Returns false on parse failure — callers that
 * want validation should call `parseCron` directly and catch.
 */
export function matchesCron(expr: string, date: Date): boolean {
  let spec: ParsedCron;
  try {
    spec = parseCron(expr);
  } catch {
    return false;
  }

  if (!spec.minute.has(date.getMinutes())) return false;
  if (!spec.hour.has(date.getHours())) return false;
  if (!spec.month.has(date.getMonth() + 1)) return false;

  const dom = date.getDate();
  const dow = date.getDay();

  if (!spec.domRestricted && !spec.dowRestricted) return true;
  if (spec.domRestricted && spec.dowRestricted) {
    return spec.dom.has(dom) || spec.dow.has(dow);
  }
  if (spec.domRestricted) return spec.dom.has(dom);
  return spec.dow.has(dow);
}

/** Parse-only validation. Throws on invalid; returns void on valid. */
export function validateCron(expr: string): void {
  parseCron(expr);
}

const ONE_MINUTE_MS = 60_000;
const DEFAULT_HORIZON_DAYS = 30;

/**
 * Return the next `limit` fires of `expr` starting from `from` (default now),
 * giving up after `horizonDays` (default 30) even if fewer matches were
 * found. Minute-resolution forward scan; cheap enough for a chip list in
 * the cron editor but NOT suitable as a scheduler hot path.
 *
 * Returns `[]` on parse failure so UI code can render "no preview"
 * without a try/catch.
 */
export function nextFires(
  expr: string,
  limit = 5,
  from: Date = new Date(),
  horizonDays = DEFAULT_HORIZON_DAYS,
): Date[] {
  let spec: ParsedCron;
  try {
    spec = parseCron(expr);
  } catch {
    return [];
  }

  const out: Date[] = [];
  // Start at the next whole minute after `from` so the first hit isn't
  // the minute we're already sitting in (which has no useful meaning
  // for a "next fire" preview).
  const cursor = new Date(from.getTime() + ONE_MINUTE_MS);
  cursor.setSeconds(0, 0);

  const deadline = from.getTime() + horizonDays * 24 * 60 * 60_000;

  while (cursor.getTime() <= deadline && out.length < limit) {
    if (matchesParsedCron(spec, cursor)) {
      out.push(new Date(cursor.getTime()));
    }
    cursor.setTime(cursor.getTime() + ONE_MINUTE_MS);
  }
  return out;
}

/** Internal match check reusing an already-parsed spec. */
function matchesParsedCron(spec: ParsedCron, date: Date): boolean {
  if (!spec.minute.has(date.getMinutes())) return false;
  if (!spec.hour.has(date.getHours())) return false;
  if (!spec.month.has(date.getMonth() + 1)) return false;

  const dom = date.getDate();
  const dow = date.getDay();

  if (!spec.domRestricted && !spec.dowRestricted) return true;
  if (spec.domRestricted && spec.dowRestricted) {
    return spec.dom.has(dom) || spec.dow.has(dow);
  }
  if (spec.domRestricted) return spec.dom.has(dom);
  return spec.dow.has(dow);
}

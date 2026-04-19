/**
 * Tiny logic-less template renderer for notification messages.
 *
 * Supports exactly one construct: `{{key}}` — replaced with the string
 * form of `context[key]`. No conditionals, no loops, no partials, no
 * lookups through dots. Keys that don't exist render as the empty
 * string so a typo doesn't leak the rendered template to the user
 * as a bizarre-looking message.
 *
 * Why not pick up `mustache` / `handlebars` as deps:
 *  - Both have richer syntax that expands the injection surface. A
 *    rule's template is operator-controlled (trust level: high), but
 *    the context values come from event payloads which originate at
 *    PVE / the scheduler / external webhooks — trust level: low.
 *    Keeping the grammar to `{{key}}` means a hostile payload can
 *    only ever produce a literal string.
 *  - Tiny-single-function keeps the bundle leaner; we already prune
 *    deps aggressively.
 *
 * Why explicitly no HTML escaping:
 *  - Destinations are chat/webhook systems (ntfy, Discord, generic
 *    webhook receiver). They're not HTML renderers; escaping &/</>
 *    would produce `&amp;` garbage in a Discord message.
 *  - Each destination handles its own formatting quirks in its
 *    dispatcher (Discord wants `content`, ntfy wants `message`, etc.).
 */

export type TemplateContext = Record<
  string,
  string | number | boolean | null | undefined
>;

// Match `{{ key }}` — whitespace-tolerant, dotless key to keep the grammar
// deliberately narrow. We reject keys with characters outside the set so
// a `{{ constructor.constructor('...')() }}` -style payload can't even
// reach the context lookup.
const TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Render a template against a context. Missing / non-renderable values
 * become the empty string — no error. This is on purpose: a notification
 * that's ugly ("Ticket renewed for ") is still better than a dropped
 * notification because the payload didn't include a key.
 */
export function renderTemplate(
  template: string,
  context: TemplateContext,
): string {
  return template.replace(TOKEN_RE, (_match, key: string) => {
    // Own-property lookup only. A raw `context[key]` walks the
    // prototype chain, so a crafted key like `__proto__` or
    // `constructor` returns `Object.prototype` / the Object
    // constructor, which `String()` then renders as
    // "[object Object]" / "function Object() {…}" — information
    // disclosure via a "missing" key. Narrow to hasOwn so only the
    // payload the caller actually passed is reachable.
    if (!Object.hasOwn(context, key)) return '';
    const raw = context[key];
    if (raw === undefined || raw === null) return '';
    // Coerce via String() — booleans come out as "true"/"false",
    // numbers use toString(), no locale-dependent formatting.
    return String(raw);
  });
}

/**
 * Humanise a fire-duration (in ms) for the `{{firingFor}}` resolve-template
 * variable. Returns the two largest non-zero units — e.g. `23m`, `2h 14m`,
 * `3d 1h`. Sub-minute durations collapse to `just now` so a rule that
 * fires and clears inside one tick doesn't produce `0m`. Negative or
 * non-finite input returns `''` so a missing `lastFireAt` renders as
 * empty rather than as a literal "just now".
 */
export function humaniseFiringFor(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours - days * 24}h`;
  if (hours >= 1) return `${hours}h ${minutes - hours * 60}m`;
  return `${minutes}m`;
}

/**
 * List the keys a template references, in source order. Powers the UI
 * preview ("this template uses: node, reason") and the rule editor's
 * sanity check that all referenced keys exist for the chosen event kind.
 */
export function collectKeys(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    const k = m[1];
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

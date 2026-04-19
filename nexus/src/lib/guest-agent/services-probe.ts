/**
 * Parser for `systemctl list-units --state=failed --no-legend --plain --no-pager`.
 *
 * Output shape is five space-separated columns:
 *   UNIT  LOAD  ACTIVE  SUB  DESCRIPTION...
 *
 * Description can contain spaces — we join columns 5+. Lines with fewer
 * than 5 columns are skipped (malformed / informational messages like
 * "0 loaded units listed.").
 */
export interface ParsedFailedUnit {
  unit: string;
  description: string;
}

export function parseFailedUnits(raw: string): ParsedFailedUnit[] {
  const out: ParsedFailedUnit[] = [];
  for (const rawLine of raw.split('\n')) {
    // Strip the systemd status glyph (● / ○ / *) that modern systemd
    // prepends to failed/alert units even with --plain --no-legend.
    const line = rawLine.trim().replace(/^[●○*]\s+/, '');
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const unit = parts[0];
    const description = parts.slice(4).join(' ').trim();
    if (!unit.includes('.')) continue; // systemctl unit names always have a type suffix
    out.push({ unit, description });
  }
  return out;
}

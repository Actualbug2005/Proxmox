/**
 * Shared journal-line parser.
 *
 * PVE's `GET /nodes/{node}/journal` returns raw journalctl lines like
 *   "Apr 14 23:06:22 pve pveproxy[12345]: TLS handshake failed"
 * which both the logs page and the task-correlation drawer need to
 * break apart into time/host/unit/message + a priority hint.
 *
 * Kept in its own module so the regex + priority heuristic live in one
 * place. Extracted verbatim from dashboard/system/logs/page.tsx.
 */

export type Priority = 'error' | 'warning' | 'info' | 'debug';

export interface ParsedJournalLine {
  raw: string;
  time: string;
  host: string;
  unit: string;
  message: string;
  priority: Priority;
}

// Syslog RFC 5424 priorities 0-3 = error severity; 4 = warning; 5-6 = info;
// 7 = debug. journalctl prefixes kernel lines with "<N>"; everything else
// we infer from well-known keywords in the message body.
const ERROR_RE = /<[0-3]>|\b(?:error|fatal|panic|segfault|crit(?:ical)?|emerg)\b/i;
const WARN_RE = /<4>|\bwarn(?:ing)?\b/i;
const DEBUG_RE = /<7>|\bdebug\b/i;

export function parsePriority(line: string, message: string): Priority {
  const probe = `${line} ${message}`;
  if (ERROR_RE.test(probe)) return 'error';
  if (WARN_RE.test(probe)) return 'warning';
  if (DEBUG_RE.test(probe)) return 'debug';
  return 'info';
}

const LINE_RE = /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:]+?):\s+(.*)$/;

export function parseJournalLine(raw: string): ParsedJournalLine {
  const m = raw.match(LINE_RE);
  if (!m) {
    return {
      raw,
      time: '',
      host: '',
      unit: '',
      message: raw,
      priority: parsePriority(raw, raw),
    };
  }
  const [, time, host, unitWithPid, message] = m;
  const unit = unitWithPid.replace(/\[\d+\]$/, '');
  return { raw, time, host, unit, message, priority: parsePriority(raw, message) };
}

/** Tailwind class bundle for a priority pip. Kept here so consumers
 *  render consistently; extracted from the logs page. */
export const PRIORITY_CLASS: Record<Priority, string> = {
  error: 'bg-red-500/10 text-red-400 border border-red-500/20',
  warning: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  info: 'bg-zinc-800/40 text-zinc-400 border border-zinc-800/60',
  debug: 'bg-zinc-800 text-zinc-500 border border-zinc-800/60',
};

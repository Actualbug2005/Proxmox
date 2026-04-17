/**
 * Log-correlation hooks.
 *
 *   useJournalWindow(node, since, until) — fetch journalctl lines in a
 *     time window and parse each into ParsedJournalLine. Used by the
 *     task correlation drawer (Phase 3) to show what was happening on
 *     the host while a task ran.
 *
 *   useTaskLog(node, upid) — fetch the PVE task's own log (the output
 *     PVE captured from whatever the task was doing, e.g., migration
 *     progress or stopAll).
 *
 * Both disable themselves when their inputs are null so a drawer that
 * isn't open doesn't hammer the endpoints.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { parseJournalLine, type ParsedJournalLine } from '@/lib/journal-parse';

const DEFAULT_MAX_LINES = 500;

interface UseJournalWindowOptions {
  /** Cap on lines returned. PVE accepts `lastentries`; we pass it
   *  through so a busy host doesn't push thousands of lines at us.
   *  Default 500. */
  lastentries?: number;
  enabled?: boolean;
}

/**
 * Fetch + parse journal entries between two seconds-epoch timestamps.
 * PVE's /nodes/{node}/journal wrapper around journalctl accepts
 * `since` / `until` as seconds-since-epoch strings (inherited from
 * journalctl's documented accepted formats).
 */
export function useJournalWindow(
  node: string | null,
  since: number | null,
  until: number | null,
  opts: UseJournalWindowOptions = {},
): UseQueryResult<ParsedJournalLine[], Error> {
  const lastentries = opts.lastentries ?? DEFAULT_MAX_LINES;
  const enabled =
    (opts.enabled ?? true) && !!node && since !== null && until !== null && until >= since;

  return useQuery<ParsedJournalLine[], Error>({
    queryKey: ['journal-window', node, since, until, lastentries],
    enabled,
    queryFn: async () => {
      const raw = await api.nodes.journal(node!, {
        since: String(since),
        until: String(until),
        lastentries,
      });
      return raw.map(parseJournalLine);
    },
    // The window is stable for the lifetime of the drawer — no need to
    // refetch on focus. The user can close/reopen to force a fresh pull.
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export interface TaskLogLine {
  n: number;
  t: string;
}

/**
 * Fetch the task's own captured output (stdout/stderr equivalents as
 * PVE writes them). Small in most cases (a few dozen lines) but a
 * long migration can produce hundreds.
 */
export function useTaskLog(
  node: string | null,
  upid: string | null,
): UseQueryResult<TaskLogLine[], Error> {
  return useQuery<TaskLogLine[], Error>({
    queryKey: ['task-log', node, upid],
    enabled: !!node && !!upid,
    queryFn: () => api.tasks.log(node!, upid!),
    staleTime: 30_000,
    refetchInterval: false,
    retry: 1,
  });
}

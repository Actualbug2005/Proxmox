/**
 * Await a single PVE task by UPID.
 *
 * Proxmox lifecycle endpoints (clone, migrate, start, etc.) return a
 * UPID and PVE processes the work asynchronously. Anything that needs
 * to do work *after* one of those tasks — e.g., applying cloud-init
 * config to a freshly-cloned VM — must wait for the UPID to become
 * terminal (status=stopped) or it races PVE's VM lock and gets a 403.
 *
 * This hook polls `/nodes/{node}/tasks/{upid}/status` every 2s while
 * the task is running, then stops. Callers consume `state` as a
 * small state machine: idle → waiting → done | timeout | error.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import type { PVETask } from '@/types/proxmox';

export type TaskCompletionState = 'idle' | 'waiting' | 'done' | 'timeout' | 'error';

export interface TaskCompletionResult {
  /** PVE status field — 'running' | 'stopped'. */
  status?: string;
  /** 'OK' on success, anything else is the failure reason. Present only when terminal. */
  exitstatus?: string;
  /** True when exitstatus === 'OK'. */
  ok?: boolean;
  /** Network / transport error from the last poll, if any. */
  error?: Error;
}

interface UseTaskCompletionOptions {
  pollIntervalMs?: number;
  /** Upper bound; past this, state flips to 'timeout' regardless of PVE response. */
  maxWaitMs?: number;
}

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;

export function useTaskCompletion(
  node: string | null,
  upid: string | null,
  opts: UseTaskCompletionOptions = {},
): { state: TaskCompletionState; result: TaskCompletionResult } {
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  // Stamp a start time the first time (node, upid) becomes non-null, so the
  // watchdog math is relative to when WE started awaiting — not when the PVE
  // task itself was submitted (which could predate this hook's mount).
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (node && upid) {
      startedAtRef.current = Date.now();
    } else {
      startedAtRef.current = null;
    }
  }, [node, upid]);

  const [timedOut, setTimedOut] = useState(false);

  const enabled = !!node && !!upid && !timedOut;
  const query = useQuery<PVETask, Error>({
    queryKey: ['task', node, upid, 'status'],
    enabled,
    queryFn: () => api.nodes.taskStatus(node!, upid!),
    // Only keep polling while PVE reports the task as still running. On a
    // terminal response `refetchInterval: false` stops the loop so we don't
    // keep hitting PVE for a stopped task.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return pollMs;
      if (d.status === 'stopped' && d.exitstatus !== undefined) return false;
      return pollMs;
    },
    // Don't retry aggressively — a dropped connection between poll ticks
    // is harmless and self-heals on the next tick.
    retry: 1,
  });

  // Watchdog: if we've been waiting longer than maxWaitMs, flip to timeout.
  // setTimedOut fires asynchronously inside setTimeout — not a
  // sync-state-in-effect anti-pattern. The "remaining <= 0" branch needs
  // the explicit disable because setTimedOut runs synchronously there.
  useEffect(() => {
    if (!enabled) return;
    const started = startedAtRef.current;
    if (started === null) return;
    const remaining = maxWaitMs - (Date.now() - started);
    if (remaining <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous expiry of a prior wait is the correct moment to flip state
      setTimedOut(true);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), remaining);
    return () => clearTimeout(t);
  }, [enabled, maxWaitMs, query.data]);

  if (!node || !upid) {
    return { state: 'idle', result: {} };
  }

  if (timedOut) {
    return {
      state: 'timeout',
      result: { status: query.data?.status, exitstatus: query.data?.exitstatus },
    };
  }

  if (query.error) {
    return { state: 'error', result: { error: query.error } };
  }

  const d = query.data;
  if (d && d.status === 'stopped' && d.exitstatus !== undefined) {
    return {
      state: 'done',
      result: {
        status: d.status,
        exitstatus: d.exitstatus,
        ok: d.exitstatus === 'OK',
      },
    };
  }

  return { state: 'waiting', result: { status: d?.status } };
}

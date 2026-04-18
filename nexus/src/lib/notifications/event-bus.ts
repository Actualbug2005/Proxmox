/**
 * In-process event bus for the notification engine.
 *
 * Why not Node's `events.EventEmitter`:
 *   - We want a discriminated-union API (`emit(event: NotificationEvent)`
 *     instead of `emit(name: string, ...args)`) so the compiler catches
 *     kind/payload mismatches at the call site.
 *   - Handler errors must never tear the emitter down, and must be
 *     reportable to ops. EventEmitter's default "throw on uncaught
 *     'error' listener" is specifically the wrong behaviour here.
 *   - No cross-process / IPC fan-out; a single Node process hosts all
 *     emitters + the dispatcher, so in-memory is exactly the scope.
 *
 * HMR safety: the singleton subscribers array lives on `globalThis` so
 * Next.js dev-mode re-evaluations don't stack multiple copies of the
 * bus.
 */

import type { NotificationEvent } from './types.ts';

export type EventHandler = (event: NotificationEvent) => void | Promise<void>;

declare global {

  var __nexusNotifSubscribers: Set<EventHandler> | undefined;

  var __nexusNotifDeliveryFailures: number | undefined;
}

function subscribers(): Set<EventHandler> {
  if (!globalThis.__nexusNotifSubscribers) {
    globalThis.__nexusNotifSubscribers = new Set();
  }
  return globalThis.__nexusNotifSubscribers;
}

/**
 * Subscribe to every future event. Returns an unsubscribe function —
 * keep it and call it in shutdown paths / test teardown so handlers
 * don't leak across HMR cycles.
 */
export function subscribe(handler: EventHandler): () => void {
  subscribers().add(handler);
  return () => {
    subscribers().delete(handler);
  };
}

/**
 * Emit an event to every subscriber. Handlers that throw are logged
 * with a stable `event=notification_dispatch_failed` tag so ops can
 * alert on dispatcher breakage; the emit itself never throws (a
 * broken handler must not block other handlers or the emitter).
 *
 * Async handlers are NOT awaited — fire-and-forget. Callers who need
 * to observe completion should sub + emit + await their own resolution.
 * This avoids a slow webhook POST blocking a hot PVE event loop.
 */
export function emit(event: NotificationEvent): void {
  for (const handler of subscribers()) {
    try {
      const ret = handler(event);
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        (ret as Promise<void>).catch((err) => noteDeliveryFailure(event.kind, err));
      }
    } catch (err) {
      noteDeliveryFailure(event.kind, err);
    }
  }
}

function noteDeliveryFailure(kind: string, err: unknown): void {
  globalThis.__nexusNotifDeliveryFailures =
    (globalThis.__nexusNotifDeliveryFailures ?? 0) + 1;
  const reason = err instanceof Error ? err.message : String(err);
  console.error(
    '[nexus event=notification_dispatch_failed] kind=%s reason=%s',
    kind,
    reason,
  );
}

export function getDeliveryFailureCount(): number {
  return globalThis.__nexusNotifDeliveryFailures ?? 0;
}

/** Test helper — clears subscribers between cases. */
export const __testing = {
  clear(): void {
    subscribers().clear();
  },
  size(): number {
    return subscribers().size;
  },
} as const;

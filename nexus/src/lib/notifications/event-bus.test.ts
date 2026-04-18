/**
 * Event-bus invariants:
 *   - every subscriber gets every event
 *   - a throwing handler doesn't break the emit for other subscribers
 *   - unsubscribe actually detaches
 *   - async handler rejections are counted for ops visibility, not rethrown
 */
import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import {
  emit,
  subscribe,
  getDeliveryFailureCount,
  __testing,
} from './event-bus.ts';

beforeEach(() => {
  __testing.clear();
});

function pushedEvent(kind: 'pve.renewal.failed' = 'pve.renewal.failed') {
  return { kind, at: Date.now(), payload: {} } as const;
}

describe('subscribe + emit', () => {
  it('delivers to every subscriber in order of registration', () => {
    const seen: number[] = [];
    subscribe(() => { seen.push(1); });
    subscribe(() => { seen.push(2); });
    subscribe(() => { seen.push(3); });
    emit(pushedEvent());
    assert.deepEqual(seen, [1, 2, 3]);
  });

  it('unsubscribe removes the handler', () => {
    let calls = 0;
    const unsub = subscribe(() => { calls += 1; });
    emit(pushedEvent());
    unsub();
    emit(pushedEvent());
    assert.equal(calls, 1, 'handler was invoked once, then detached');
  });
});

describe('failure isolation', () => {
  it('a throwing handler does not prevent subsequent handlers from firing', () => {
    let reached = false;
    subscribe(() => { throw new Error('boom'); });
    subscribe(() => { reached = true; });
    const before = getDeliveryFailureCount();
    emit(pushedEvent());
    assert.equal(reached, true, 'second handler fired despite first throwing');
    assert.equal(
      getDeliveryFailureCount(),
      before + 1,
      'the thrown error was counted for ops visibility',
    );
  });

  it('counts async handler rejections too', async () => {
    subscribe(async () => { throw new Error('async boom'); });
    const before = getDeliveryFailureCount();
    emit(pushedEvent());
    // Wait a microtask for the promise-chain .catch to run.
    await new Promise((r) => setImmediate(r));
    assert.equal(getDeliveryFailureCount(), before + 1);
  });
});

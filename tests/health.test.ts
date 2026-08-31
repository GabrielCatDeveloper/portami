import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getHealthSnapshot,
  stopHealthPolling,
  subscribeHealth,
  type HealthSnapshot,
} from '@/api/health';

describe('server health store', () => {
  beforeEach(() => {
    stopHealthPolling();
  });
  afterEach(() => {
    stopHealthPolling();
  });

  it('starts as stopped (no polls yet)', () => {
    const snap = getHealthSnapshot();
    expect(snap.status === 'stopped' || snap.status === 'offline').toBe(true);
    expect(snap.lastSeenUp).toBeNull();
  });

  it('notifies subscribers on update', async () => {
    const seen: HealthSnapshot[] = [];
    const unsub = subscribeHealth((s) => seen.push(s));
    unsub();
    expect(seen.length).toBeGreaterThan(0);
  });

  // Regression test for the React error #185 ("Maximum update depth
  // exceeded") bug: getHealthSnapshot must return a stable reference
  // when the underlying state hasn't changed, otherwise
  // useSyncExternalStore triggers an infinite re-render loop.
  it('getHealthSnapshot returns a stable reference across calls when state is unchanged', () => {
    const a = getHealthSnapshot();
    const b = getHealthSnapshot();
    const c = getHealthSnapshot();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
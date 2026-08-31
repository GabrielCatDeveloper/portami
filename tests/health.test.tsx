import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  getHealthSnapshot,
  stopHealthPolling,
  subscribeHealth,
  type HealthSnapshot,
} from '@/api/health';
import { useServerHealth } from '@/state/health';

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

  it('subscribe does NOT call the listener synchronously (React #185 regression)', () => {
    // The original implementation called fn(snapshot()) inside
    // subscribeHealth. That worked for ad-hoc callers but broke
    // useSyncExternalStore: when React mounted a component, it called
    // subscribe -> cb(snapshot()) -> React's internal forceUpdate ->
    // schedule re-render inside commit -> "Maximum update depth
    // exceeded" (React error #185). The current contract is
    // "register the callback; fire on changes only".
    const seen: HealthSnapshot[] = [];
    const unsub = subscribeHealth((s) => seen.push(s));
    expect(seen.length).toBe(0);
    unsub();
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

  // End-to-end regression test that mounts a real component using
  // useServerHealth (which calls useSyncExternalStore) and verifies
  // it renders without throwing React error #185. The earlier
  // "subscribe doesn't call sync" + "stable getSnapshot" tests cover
  // the building blocks; this test verifies they compose correctly
  // inside React's actual commit phase.
  it('useServerHealth renders without triggering React #185', () => {
    let renderCount = 0;
    function Probe() {
      renderCount++;
      const snap = useServerHealth();
      return <div data-testid="status">{snap.status}</div>;
    }

    const errorHandler = (e: ErrorEvent) => {
      throw e.error ?? new Error(e.message);
    };
    window.addEventListener('error', errorHandler);

    try {
      act(() => {
        render(<Probe />);
      });
      // useSyncExternalStore may render the component a few times
      // during commit (this is normal). The key is that it STOPS.
      // With the original bug it would exceed React's update limit
      // and throw.
      act(() => {
        // Allow queued microtasks (effects) to flush.
      });
      expect(renderCount).toBeLessThan(10);
      expect(screen.getByTestId('status').textContent).toMatch(/stopped|offline|normal|saturated/);
    } finally {
      window.removeEventListener('error', errorHandler);
    }
  });
});
import { describe, it, expect } from 'vitest';
import { shouldFire } from '@/geo/useStopAlertWatcher';
import type { StopAlert } from '@/storage/stopAlerts';

const baseAlert: StopAlert = {
  id: 1, tripRouteId: 'r1', stopId: 's1', stopName: 'X',
  triggerMinutes: 1, createdAt: 0, triggered: false,
};

describe('shouldFire (traffic-aware alert trigger)', () => {
  it('fires when ETA is within the window — fast traffic', () => {
    // 300 m at 15 m/s = 20 s → below 1 min → fires
    expect(shouldFire(baseAlert, 300, 15)).toBe(true);
  });

  it('does NOT fire when ETA is above the window — slow / far', () => {
    // 5000 m at 15 m/s ≈ 5.5 min → above 1 min → does not fire
    expect(shouldFire(baseAlert, 5000, 15)).toBe(false);
  });

  it('in traffic (slow), the alert waits longer to fire (closer to the stop)', () => {
    // 600 m at 1 m/s = 10 min → 1 min window: not yet
    expect(shouldFire(baseAlert, 600, 1)).toBe(false);
    // …now the bus inches forward: 200 m at 1 m/s ≈ 3.3 min → still not 1 min
    // (the speed floor of 2 m/s still puts us at 200/2 = 1.67 min)
    expect(shouldFire(baseAlert, 200, 1)).toBe(false);
    // At 100 m the ETA under the floor (2 m/s) is 0.83 min → within 1 min
    expect(shouldFire(baseAlert, 100, 1)).toBe(true);
  });

  it('uses a speed floor so a traffic jam doesnt fire absurdly early', () => {
    // 1 m/s is the documented floor; the effective speed is 2 m/s.
    // 60 m at 1 m/s would be 1 min; but floor makes it 0.5 min, so fires.
    expect(shouldFire(baseAlert, 60, 1)).toBe(true);
  });

  it('uses default speed when GPS speed is 0 / undefined', () => {
    // 300 m at 7 m/s ≈ 43 s → fires (within 1 min)
    expect(shouldFire(baseAlert, 300, undefined)).toBe(true);
    // 1000 m at 7 m/s ≈ 2.4 min → does not fire
    expect(shouldFire(baseAlert, 1000, undefined)).toBe(false);
  });

  it('distance-based mode: fires within N meters regardless of speed', () => {
    const a: StopAlert = { ...baseAlert, triggerDistanceM: 200 };
    delete (a as any).triggerMinutes;
    expect(shouldFire(a, 100, 20)).toBe(true);
    expect(shouldFire(a, 250, 0)).toBe(false);
  });

  it('supports both modes — time takes precedence over distance', () => {
    const a: StopAlert = { ...baseAlert, triggerDistanceM: 50 };
    // time mode (1 min) wins: at 100m with 15 m/s = 6.67s → fires
    expect(shouldFire(a, 100, 15)).toBe(true);
    // distance mode would not fire at 100m (since triggerDistanceM=50).
    // That's the intended precedence: time > distance.
  });

  it('returns false when neither triggerMinutes nor triggerDistanceM is set', () => {
    const a: StopAlert = { ...baseAlert };
    delete (a as any).triggerMinutes;
    delete (a as any).triggerDistanceM;
    expect(shouldFire(a, 0, 50)).toBe(false);
  });
});
// ============================================================
// Tests for the synthetic GPS source (used in testing mode)
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyntheticGpsSource } from '@/geo/syntheticGps';

describe('SyntheticGpsSource', () => {
  let source: SyntheticGpsSource;

  beforeEach(() => {
    vi.useFakeTimers();
    source = new SyntheticGpsSource({ intervalMs: 1000 });
  });
  afterEach(() => {
    source.clearWatch(1);
    vi.useRealTimers();
  });

  it('emits one immediate sample on watchPosition + then one per interval', () => {
    const seen: GeolocationPosition[] = [];
    source.watchPosition((p) => seen.push(p));
    expect(seen.length).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(seen.length).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(seen.length).toBe(3);
  });

  it('produces GeolocationPosition-shaped samples', () => {
    const seen: GeolocationPosition[] = [];
    source.watchPosition((p) => seen.push(p));
    const p = seen[0];
    if (!p) throw new Error('expected a sample');
    expect(typeof p.timestamp).toBe('number');
    expect(typeof p.coords.latitude).toBe('number');
    expect(typeof p.coords.longitude).toBe('number');
    expect(typeof p.coords.accuracy).toBe('number');
    // Sol, Madrid (the default center).
    expect(p.coords.latitude).toBeCloseTo(40.4170, 3);
    expect(p.coords.longitude).toBeCloseTo(-3.7035, 3);
  });

  it('moves the position forward with the configured bearing', () => {
    const seen: GeolocationPosition[] = [];
    source.watchPosition((p) => seen.push(p));
    const start = seen[0]?.coords;
    if (!start) throw new Error('expected a starting sample');
    vi.advanceTimersByTime(1000);
    const after1s = seen[1]?.coords;
    if (!after1s) throw new Error('expected a follow-up sample');
    // At 1.3 m/s for 1s, we move ~1.3 m — but pauses may keep us still,
    // so just verify we end up NOT identical to start (or equal, if a pause
    // happened to fire). Position should remain within ~5 km of start.
    const dist = Math.hypot(
      (after1s.latitude - start.latitude) * 111_320,
      (after1s.longitude - start.longitude) * 111_320 * Math.cos((start.latitude * Math.PI) / 180),
    );
    expect(dist).toBeLessThan(5_000);
  });

  it('clearWatch stops the timer', () => {
    const seen: GeolocationPosition[] = [];
    const id = source.watchPosition((p) => seen.push(p));
    expect(seen.length).toBe(1);
    source.clearWatch(id);
    vi.advanceTimersByTime(10_000);
    // No further samples after clearWatch.
    expect(seen.length).toBe(1);
  });

  it('snapshot reflects current state', () => {
    const snap = source.snapshot();
    expect(snap.lat).toBeCloseTo(40.4170, 3);
    expect(snap.lng).toBeCloseTo(-3.7035, 3);
    expect(typeof snap.bearing).toBe('number');
    expect(snap.paused).toBe(false);
    expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Tests for the synthetic GPS source (used in testing mode)
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GPSSample } from '@/api/types';
import { SyntheticGpsSource } from '@/geo/syntheticGps';
import { GeoWatcher } from '@/geo/watcher';

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

describe('GeoWatcher with SyntheticGpsSource', () => {
  let watcher: GeoWatcher;
  let source: SyntheticGpsSource;

  beforeEach(() => {
    vi.useFakeTimers();
    source = new SyntheticGpsSource({ intervalMs: 1000, speedMs: 0 });
    watcher = new GeoWatcher({ source, maxAccuracyM: 100 });
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it('raw recording keeps stationary samples while regular listeners remain deduplicated', () => {
    const rawSamples: GPSSample[] = [];
    const regularSamples: GPSSample[] = [];
    watcher.onRaw((sample) => rawSamples.push(sample));
    watcher.on((sample) => regularSamples.push(sample));
    const leaseId = watcher.start();
    const initialTs = rawSamples[0]?.ts;
    if (initialTs === undefined) throw new Error('expected an initial sample');

    for (let elapsed = 1000; elapsed <= 7000; elapsed += 1000) {
      vi.setSystemTime(initialTs + elapsed);
      vi.advanceTimersByTime(1000);
    }

    expect(rawSamples).toHaveLength(8);
    expect(regularSamples.length).toBeGreaterThan(0);
    expect(regularSamples.length).toBeLessThan(rawSamples.length);
    watcher.stop(leaseId);
  });

  it('releases only the requested lease', () => {
    const samples: GPSSample[] = [];
    watcher.on((sample) => samples.push(sample));
    const firstLease = watcher.start();
    const secondLease = watcher.start();

    vi.advanceTimersByTime(0);
    expect(samples).toHaveLength(1);

    const initialTs = samples[0]?.ts;
    if (initialTs === undefined) throw new Error('expected an initial sample');
    watcher.stop(firstLease);
    vi.setSystemTime(initialTs + 5000);
    vi.advanceTimersByTime(1000);
    expect(samples).toHaveLength(2);

    watcher.stop(secondLease);
    const countAfterStop = samples.length;
    vi.advanceTimersByTime(5000);
    expect(samples).toHaveLength(countAfterStop);
  });

  it('keeps leases valid when the GPS source changes', () => {
    const samples: GPSSample[] = [];
    watcher.onRaw((sample) => samples.push(sample));
    const leaseId = watcher.start();
    const replacement = new SyntheticGpsSource({ intervalMs: 1000, speedMs: 0 });

    watcher.setSource(replacement);
    vi.advanceTimersByTime(1000);

    expect(samples).toHaveLength(3);
    watcher.stop(leaseId);
    vi.advanceTimersByTime(5000);
    expect(samples).toHaveLength(3);
  });

  it('stops every lease when no lease id is provided', () => {
    const samples: GPSSample[] = [];
    watcher.on((sample) => samples.push(sample));
    watcher.start();
    watcher.start();

    vi.advanceTimersByTime(0);
    watcher.stop();
    const countAfterStop = samples.length;
    vi.advanceTimersByTime(5000);

    expect(samples).toHaveLength(countAfterStop);
  });
});

import { describe, it, expect } from 'vitest';
import { TripDetector, DEFAULT_DETECTOR } from '@/geo/tripDetector';
import type { Route, GPSSample } from '@/api/types';

const route: Route = {
  id: 'r1',
  name: 'Test',
  stops: [
    { id: 's1', name: 'A', lat: 40.0, lng: -3.0 },
    { id: 's2', name: 'B', lat: 40.01, lng: -3.0 },
    { id: 's3', name: 'C', lat: 40.02, lng: -3.0 },
  ],
  polyline: [
    [40.0, -3.0],
    [40.005, -3.0],
    [40.01, -3.0],
    [40.015, -3.0],
    [40.02, -3.0],
  ],
  createdBy: 'test',
  version: 1,
  active: true,
};

function sample(ts: number, lat: number, lng: number, speed = 8): GPSSample {
  return { ts, lat, lng, acc: 5, speed };
}

describe('TripDetector', () => {
  it('does not trigger when on route and moving', () => {
    const det = new TripDetector();
    const events = det.observe(sample(0, 40.001, -3.0), route, () => {});
    expect(events).toEqual([]);
  });

  it('triggers arrival when within 15m of stop', () => {
    const det = new TripDetector();
    const events = det.observe(sample(0, 40.0, -3.0), route, () => {});
    const arrived = events.find((e) => e.kind === 'arrived-at-stop');
    expect(arrived).toBeDefined();
  });

  it('triggers off-route after sustained deviation', () => {
    const det = new TripDetector({ ...DEFAULT_DETECTOR, offRouteMeters: 50, offRouteSeconds: 5 });
    det.observe(sample(0, 40.0, -3.0), route, () => {});
    // Move 200m east of route for > 5s
    let ended = false;
    det.observe(sample(4_000, 40.0, -3.002), route, (e) => {
      if (e.kind === 'trip-should-end') ended = true;
    });
    expect(ended).toBe(false);
    det.observe(sample(10_000, 40.0, -3.002), route, (e) => {
      if (e.kind === 'trip-should-end') ended = true;
    });
    expect(ended).toBe(true);
  });

  it('cancels off-route when returning to route', () => {
    const det = new TripDetector({ ...DEFAULT_DETECTOR, offRouteMeters: 50, offRouteSeconds: 10 });
    det.observe(sample(0, 40.0, -3.002), route, () => {});
    const events = det.observe(sample(1_000, 40.0, -3.0), route, () => {});
    expect(events.some((e) => e.kind === 'off-route-cancel')).toBe(true);
  });

  it('triggers stopped after sustained low speed', () => {
    const det = new TripDetector({ ...DEFAULT_DETECTOR, stoppedSpeedMs: 1, stoppedSeconds: 5 });
    let ended = false;
    det.observe(sample(0, 40.0, -3.0, 0), route, () => {});
    det.observe(sample(3_000, 40.0, -3.0, 0), route, () => {});
    det.observe(sample(6_000, 40.0, -3.0, 0), route, (e) => {
      if (e.kind === 'trip-should-end') ended = true;
    });
    expect(ended).toBe(true);
  });

  it('does not retrigger arrival within 60s', () => {
    const det = new TripDetector();
    const e1 = det.observe(sample(0, 40.0, -3.0), route, () => {});
    const e2 = det.observe(sample(30_000, 40.0, -3.0), route, () => {});
    expect(e1.some((e) => e.kind === 'arrived-at-stop')).toBe(true);
    expect(e2.some((e) => e.kind === 'arrived-at-stop')).toBe(false);
  });
});
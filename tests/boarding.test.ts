import { describe, it, expect } from 'vitest';
import { matchRoutesByProximity } from '@/geo/matchRoutes';
import { estimateStopEtas, formatEta } from '@/geo/eta';
import type { Route, GPSSample } from '@/api/types';

const sampleRoute: Route = {
  id: 'r1',
  name: 'Test Line',
  stops: [
    { id: 's1', name: 'Plaza Mayor', lat: 40.4150, lng: -3.7070 },
    { id: 's2', name: 'Sol', lat: 40.4170, lng: -3.7035 },
    { id: 's3', name: 'Atocha', lat: 40.4067, lng: -3.6907 },
  ],
  polyline: [
    [40.4150, -3.7070],
    [40.4170, -3.7035],
    [40.4100, -3.6970],
    [40.4067, -3.6907],
  ],
  createdBy: 'test',
  version: 1,
  active: true,
  vehicleKind: 'bus',
};

describe('matchRoutesByProximity', () => {
  it('finds the closest route by point-to-polyline distance', () => {
    const far: Route = {
      ...sampleRoute,
      id: 'r-far',
      polyline: [
        [41.0, -3.7], [41.1, -3.8], [41.2, -3.9], // 60+ km away
      ],
    };
    const matches = matchRoutesByProximity(
      { lat: 40.4150, lng: -3.7070 },
      [far, sampleRoute],
    );
    expect(matches[0]?.route.id).toBe('r1');
    expect(matches[0]?.distanceM).toBeLessThan(20);
  });

  it('orders by score (closer + longer = higher score)', () => {
    const longRoute: Route = {
      ...sampleRoute,
      id: 'r-long',
      polyline: [
        [40.40, -3.70], [40.42, -3.71], [40.44, -3.72],
        [40.46, -3.73], [40.48, -3.74], [40.50, -3.75],
      ],
    };
    const matches = matchRoutesByProximity(
      { lat: 40.42, lng: -3.71 },
      [sampleRoute, longRoute],
    );
    // The longer route that passes close to the point should rank higher
    // than the shorter route that passes close to the point.
    expect(matches[0]?.route.id).toBe('r-long');
  });

  it('excludes routes outside the radius', () => {
    const matches = matchRoutesByProximity(
      { lat: 41.6520, lng: -0.0880 }, // Zaragoza
      [sampleRoute],
      { maxRadiusM: 5000 },
    );
    expect(matches).toHaveLength(0);
  });

  it('respects topN limit', () => {
    const routes: Route[] = Array.from({ length: 10 }, (_, i) => ({
      ...sampleRoute,
      id: `r-${i}`,
      polyline: [
        [40.0 + i * 0.001, -3.7 + i * 0.001],
        [40.0 + i * 0.001, -3.7 + i * 0.001 + 0.001],
      ],
    }));
    const matches = matchRoutesByProximity(
      { lat: 40.0, lng: -3.7 },
      routes,
      { topN: 3, maxRadiusM: 50000 },
    );
    expect(matches).toHaveLength(3);
  });
});

describe('estimateStopEtas', () => {
  it('returns per-stop distances and ETAs sorted by distance', () => {
    const pos: GPSSample = {
      ts: Date.now(),
      lat: 40.4170,
      lng: -3.7035, // at stop s2 (Sol)
      acc: 5,
      speed: 10, // 10 m/s = 36 km/h
    };
    const etas = estimateStopEtas(sampleRoute, pos);
    expect(etas.length).toBe(3);
    // Sorted by distance ascending
    for (let i = 1; i < etas.length; i++) {
      expect(etas[i]?.distanceM).toBeGreaterThanOrEqual(etas[i - 1]?.distanceM ?? 0);
    }
  });

  it('returns empty for routes with no stops', () => {
    const etas = estimateStopEtas({ ...sampleRoute, stops: [] }, {
      ts: 0, lat: 40, lng: -3, acc: 5, speed: 10,
    });
    expect(etas).toEqual([]);
  });
});

describe('formatEta', () => {
  it('formats seconds when under a minute', () => {
    expect(formatEta(30_000)).toBe('30 s');
    expect(formatEta(500)).toBe('1 s');
  });
  it('formats minutes under an hour', () => {
    expect(formatEta(120_000)).toBe('2 min');
    expect(formatEta(15 * 60_000)).toBe('15 min');
  });
  it('formats hours and minutes', () => {
    expect(formatEta(90 * 60_000)).toBe('1 h 30 min');
  });
  it('handles invalid', () => {
    expect(formatEta(-1)).toBe('—');
    expect(formatEta(NaN)).toBe('—');
  });
});
import { describe, it, expect } from 'vitest';
import {
  haversine,
  pointToSegmentMeters,
  distanceToPolyline,
  polylineLength,
  nearestPointOnPolyline,
  nearestStop,
  speedBetween,
  formatDistance,
} from '@/geo/distance';

describe('distance utilities', () => {
  it('haversine computes known distance (Madrid → Barcelona ≈ 505 km)', () => {
    const d = haversine({ lat: 40.4168, lng: -3.7038 }, { lat: 41.3851, lng: 2.1734 });
    expect(d / 1000).toBeGreaterThan(500);
    expect(d / 1000).toBeLessThan(515);
  });

  it('haversine returns 0 for same point', () => {
    expect(haversine({ lat: 40, lng: -3 }, { lat: 40, lng: -3 })).toBe(0);
  });

  it('pointToSegmentMeters projects correctly', () => {
    // Vertical segment along lng=-3, from lat 40 to lat 41
    const a = { lat: 40, lng: -3 };
    const b = { lat: 41, lng: -3 };
    const p = { lat: 40.5, lng: -2.99 }; // ~830m east
    const d = pointToSegmentMeters(p, a, b);
    expect(d).toBeGreaterThan(800);
    expect(d).toBeLessThan(900);
  });

  it('distanceToPolyline returns min over all segments', () => {
    const polyline: Array<[number, number]> = [
      [40, -3],
      [40, -2],
      [40, -1],
    ];
    const d = distanceToPolyline({ lat: 40.01, lng: -2 }, polyline);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });

  it('polylineLength sums segment lengths', () => {
    // Polyline spans 1 degree lng at lat 40 → ~85 km per segment
    const polyline: Array<[number, number]> = [
      [40, -3],
      [40, -2],
      [40, -1],
    ];
    const total = polylineLength(polyline);
    expect(total / 1000).toBeGreaterThan(160);
    expect(total / 1000).toBeLessThan(180);
  });

  it('nearestPointOnPolyline finds closest vertex', () => {
    const polyline: Array<[number, number]> = [
      [40, -3],
      [41, -2],
      [42, -1],
    ];
    const { idx } = nearestPointOnPolyline({ lat: 40.9, lng: -2 }, polyline);
    expect(idx).toBe(1);
  });

  it('nearestStop returns closest stop', () => {
    const stops = [
      { id: 'a', lat: 40.0, lng: -3.0 },
      { id: 'b', lat: 41.0, lng: -2.0 },
    ];
    // Closer to a
    const ns1 = nearestStop({ lat: 40.05, lng: -3.0 }, stops)!;
    expect(ns1.stop.id).toBe('a');
    // Closer to b
    const ns2 = nearestStop({ lat: 40.95, lng: -2.0 }, stops)!;
    expect(ns2.stop.id).toBe('b');
  });

  it('speedBetween calculates m/s', () => {
    // 100m in 10s = 10 m/s
    const a = { ts: 0, lat: 40, lng: -3 };
    const b = { ts: 10_000, lat: 40.0009, lng: -3 }; // ~100m
    const speed = speedBetween(a, b);
    expect(speed).toBeGreaterThan(8);
    expect(speed).toBeLessThan(12);
  });

  it('formatDistance uses m for short, km for long', () => {
    expect(formatDistance(50)).toBe('50 m');
    expect(formatDistance(1500)).toBe('1.50 km');
    expect(formatDistance(15000)).toBe('15.0 km');
  });
});
import type { LatLng } from '@/api/types';

const EARTH_R = 6371000; // m

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

// Haversine great-circle distance (meters)
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

// Distance from point P to segment AB in meters (planar approximation, OK for short distances)
export function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  // Project to local meters
  const ax = 0,
    ay = 0;
  const bx = (b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2)) * 111_320;
  const by = (b.lat - a.lat) * 110_540;
  const px = (p.lng - a.lng) * Math.cos(toRad((a.lat + p.lat) / 2)) * 111_320;
  const py = (p.lat - a.lat) * 110_540;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversine(p, a);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

// Minimum distance from point to any segment of polyline
export function distanceToPolyline(p: LatLng, polyline: Array<[number, number]>): number {
  let min = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const aPt = polyline[i - 1];
    const bPt = polyline[i];
    if (!aPt || !bPt) continue;
    const a = { lat: aPt[0], lng: aPt[1] };
    const b = { lat: bPt[0], lng: bPt[1] };
    const d = pointToSegmentMeters(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

// Index of nearest point on polyline (used for "where am I on the route")
export function nearestPointOnPolyline(
  p: LatLng,
  polyline: Array<[number, number]>,
): { idx: number; distance: number } {
  let best = { idx: 0, distance: Infinity };
  for (let i = 0; i < polyline.length; i++) {
    const pt = polyline[i];
    if (!pt) continue;
    const d = haversine(p, { lat: pt[0], lng: pt[1] });
    if (d < best.distance) best = { idx: i, distance: d };
  }
  return best;
}

// Polyline length in meters
export function polylineLength(polyline: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    const aPt = polyline[i - 1];
    const bPt = polyline[i];
    if (!aPt || !bPt) continue;
    total += haversine(
      { lat: aPt[0], lng: aPt[1] },
      { lat: bPt[0], lng: bPt[1] },
    );
  }
  return total;
}

// Find nearest stop
export function nearestStop(
  p: LatLng,
  stops: Array<{ id: string; lat: number; lng: number }>,
): { stop: { id: string; lat: number; lng: number }; distance: number } | null {
  if (!stops.length) return null;
  let best: { stop: typeof stops[number]; distance: number } | null = null;
  for (const s of stops) {
    const d = haversine(p, s);
    if (!best || d < best.distance) best = { stop: s, distance: d };
  }
  return best;
}

// Speed (m/s) between two samples
export function speedBetween(a: { ts: number; lat: number; lng: number }, b: { ts: number; lat: number; lng: number }): number {
  const dt = (b.ts - a.ts) / 1000;
  if (dt <= 0) return 0;
  return haversine(a, b) / dt;
}

// Format distance nicely
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

// Format duration nicely (ms → "X min")
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}
// ============================================================
// ETA estimation per stop from a current bus position
// Returns a best-effort ETA in milliseconds for each stop.
// Marked as an estimation everywhere it's shown in the UI.
// ============================================================

import type { Route, GPSSample } from '@/api/types';
import { distanceToPolyline, haversine, nearestPointOnPolyline } from '@/geo/distance';

export type StopEta = {
  stopId: string;
  stopName: string;
  distanceM: number;
  etaMs: number;
};

const DEFAULT_SPEED_MS = 8; // ~29 km/h if no speed available

/**
 * Estimate arrival time at each stop of `route` given the current
 * position `pos`. We pick a segment of the polyline near the bus, then
 * project each stop onto the polyline and accumulate distance from
 * the bus's projected position to that stop, using either the bus's
 * last reported speed or a default.
 *
 * NOTE: this is an estimation. Real arrival depends on traffic, stops,
 * signals, and any detours reported by other users.
 */
export function estimateStopEtas(route: Route, pos: GPSSample): StopEta[] {
  if (!route.stops.length) return [];

  // Find the closest point on the polyline to the bus's current position
  const proj = nearestPointOnPolyline({ lat: pos.lat, lng: pos.lng }, route.polyline);

  // Distance from bus to each stop (along the polyline, approximately)
  // We use the stop's straight-line distance from the bus's projected
  // point; good enough for an estimation, with the speed carrying the rest.
  const speed = (pos.speed ?? DEFAULT_SPEED_MS);
  return route.stops.map((stop) => {
      const distanceM = haversine(
        { lat: route.polyline[proj.idx][0], lng: route.polyline[proj.idx][1] },
        { lat: stop.lat, lng: stop.lng },
      );
      const etaMs = distanceM / Math.max(0.5, speed) * 1000;
      return {
        stopId: stop.id,
        stopName: stop.name,
        distanceM,
        etaMs,
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Convert ms to a friendly "X min" / "X sec" string. */
export function formatEta(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${m} min`;
}

void distanceToPolyline;
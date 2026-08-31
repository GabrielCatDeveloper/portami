// ============================================================
// Match a GPS position against a list of routes
// Returns the top-N routes ranked by minimum distance from the point
// to any segment of the polyline.
// ============================================================

import type { Route } from '@/api/types';
import { distanceToPolyline, polylineLength } from '@/geo/distance';

export type RouteMatch = {
  route: Route;
  distanceM: number;
  /** 0..1 — higher is a better match. */
  score: number;
};

export function matchRoutesByProximity(
  point: { lat: number; lng: number },
  routes: Route[],
  opts: { topN?: number; maxRadiusM?: number; minScore?: number } = {},
): RouteMatch[] {
  const topN = opts.topN ?? 5;
  const maxRadiusM = opts.maxRadiusM ?? 5000;
  const minScore = opts.minScore ?? 0;
  const matches: RouteMatch[] = routes
    .map((route) => {
      const distanceM = distanceToPolyline(point, route.polyline);
      const lengthKm = polylineLength(route.polyline) / 1000;
      // Longer routes get a small boost: matching near a long route is a
      // stronger signal than matching the endpoint of a 200 m stub.
      const lengthFactor = Math.min(1, Math.max(0.1, lengthKm) / 3);
      const distanceScore = 1 - Math.min(1, distanceM / maxRadiusM);
      const score = distanceScore * (0.5 + 0.5 * lengthFactor);
      return { route, distanceM, score };
    })
    .filter((m) => m.distanceM <= maxRadiusM && m.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return matches.slice(0, topN);
}
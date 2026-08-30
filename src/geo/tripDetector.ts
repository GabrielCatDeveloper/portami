// ============================================================
// Heuristic detector for "user got off the bus"
// ============================================================
import type { GPSSample, Route } from '@/api/types';
import { distanceToPolyline, haversine } from '@/geo/distance';

export type DetectorConfig = {
  offRouteMeters: number;        // default 75
  offRouteSeconds: number;       // default 90
  stoppedSpeedMs: number;        // default 1 m/s
  stoppedSeconds: number;        // default 300 (5 min)
  stopRadiusMeters: number;      // default 15
};

export const DEFAULT_DETECTOR: DetectorConfig = {
  offRouteMeters: 75,
  offRouteSeconds: 90,
  stoppedSpeedMs: 1,
  stoppedSeconds: 300,
  stopRadiusMeters: 15,
};

export type DetectorEvent =
  | { kind: 'off-route-start'; ts: number }
  | { kind: 'off-route-cancel' }
  | { kind: 'stopped-start'; ts: number }
  | { kind: 'stopped-cancel' }
  | { kind: 'arrived-at-stop'; stopId: string }
  | { kind: 'trip-should-end'; reason: 'off-route' | 'stopped' };

export class TripDetector {
  private offRouteSince: number | null = null;
  private stoppedSince: number | null = null;
  private lastStopNotif = new Map<string, number>();

  constructor(private cfg: DetectorConfig = DEFAULT_DETECTOR) {}

  observe(sample: GPSSample, route: Route, on: (e: DetectorEvent) => void): DetectorEvent[] {
    const events: DetectorEvent[] = [];

    // Off-route check
    const distM = distanceToPolyline({ lat: sample.lat, lng: sample.lng }, route.polyline);
    if (distM > this.cfg.offRouteMeters) {
      if (this.offRouteSince === null) {
        this.offRouteSince = sample.ts;
        events.push({ kind: 'off-route-start', ts: sample.ts });
      } else if (sample.ts - this.offRouteSince >= this.cfg.offRouteSeconds * 1000) {
        events.push({ kind: 'trip-should-end', reason: 'off-route' });
        this.offRouteSince = null;
      }
    } else if (this.offRouteSince !== null) {
      this.offRouteSince = null;
      events.push({ kind: 'off-route-cancel' });
    }

    // Stopped check
    const speed = sample.speed ?? 0;
    if (speed < this.cfg.stoppedSpeedMs) {
      if (this.stoppedSince === null) {
        this.stoppedSince = sample.ts;
        events.push({ kind: 'stopped-start', ts: sample.ts });
      } else if (sample.ts - this.stoppedSince >= this.cfg.stoppedSeconds * 1000) {
        events.push({ kind: 'trip-should-end', reason: 'stopped' });
        this.stoppedSince = null;
      }
    } else if (this.stoppedSince !== null) {
      this.stoppedSince = null;
      events.push({ kind: 'stopped-cancel' });
    }

    // Arrived at stop check
    for (const stop of route.stops) {
      const d = haversine({ lat: sample.lat, lng: sample.lng }, stop);
      if (d <= this.cfg.stopRadiusMeters) {
        const last = this.lastStopNotif.get(stop.id);
        if (last === undefined || sample.ts - last > 60_000) {
          this.lastStopNotif.set(stop.id, sample.ts);
          events.push({ kind: 'arrived-at-stop', stopId: stop.id });
        }
      }
    }

    events.forEach(on);
    return events;
  }

  reset() {
    this.offRouteSince = null;
    this.stoppedSince = null;
    this.lastStopNotif.clear();
  }
}
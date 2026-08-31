// Stop alert trigger: monitors GPS samples, fires strong alerts when
// the bus is within the configured threshold of an alert's stop.
//
// Two trigger modes (per alert):
//   - triggerMinutes: fire when ETA to the stop ≤ N minutes. ETA is
//     computed from current speed (or a sensible default if speed is
//     0 / missing). This adapts to traffic — see ALERT_TRAFFIC_* below.
//   - triggerDistanceM: fire when within N meters. Used as a fallback
//     when the bus is stopped and the ETA would otherwise be huge.
//
// The alert is marked triggered in IndexedDB so it only fires once per
// trip. `resetTriggered(routeId)` is called when a new trip starts.

import { useEffect, useRef } from 'react';
import type { GPSSample, Route } from '@/api/types';
import { haversine } from '@/geo/distance';
import { listAlertsForRoute, markTriggered, type StopAlert } from '@/storage/stopAlerts';
import { alertUser } from '@/notify/alert';
import { useStopAlertStore } from '@/state/stopAlerts';

type Options = {
  route: Route | null;
  sample: GPSSample | null;
  /** When false, we don't fire (trip not active). */
  enabled: boolean;
};

/** Speed used when GPS reports 0 / unknown. Slightly below urban avg. */
const ALERT_DEFAULT_SPEED_MS = 7; // ~25 km/h
/**
 * Floor for ETA computation. In a traffic jam (speed=0.3 m/s) we
 * don't want the alert to fire 30 min early because the driver might
 * move again in 10 seconds. Capping at 2 m/s keeps the fire distance
 * within a sensible range (e.g. 1 min warning → at most 120 m).
 */
const ALERT_TRAFFIC_FLOOR_MS = 2; // ~7 km/h, slow traffic
const MAX_TRIGGER_DISTANCE_M = 3000; // hard cap so we don't fire 5 km away

export function shouldFire(alert: StopAlert, distanceM: number, speedMs: number | undefined): boolean {
  // Time-based: ETA in minutes
  if (alert.triggerMinutes != null) {
    const v = speedMs && speedMs > 0 ? speedMs : ALERT_DEFAULT_SPEED_MS;
    const effective = Math.max(v, ALERT_TRAFFIC_FLOOR_MS);
    const etaMin = distanceM / effective / 60;
    if (etaMin <= alert.triggerMinutes) return true;
  }
  // Distance-based fallback
  if (alert.triggerDistanceM != null) {
    if (distanceM <= alert.triggerDistanceM) return true;
  }
  return false;
}

export function useStopAlertWatcher({ route, sample, enabled }: Options): {
  alerts: StopAlert[];
  reload: () => void;
} {
  const alerts = useStopAlertStore((s) => s.alerts);
  const setAlerts = useStopAlertStore((s) => s.setAlerts);
  const lastSampleRef = useRef<GPSSample | null>(null);

  // Reload alerts when route changes
  useEffect(() => {
    if (!route) {
      setAlerts([]);
      return;
    }
    let cancelled = false;
    void listAlertsForRoute(route.id).then((a) => {
      if (!cancelled) setAlerts(a);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch only when the route changes; setAlerts is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id, setAlerts]);

  // Evaluate on every new sample
  useEffect(() => {
    if (!enabled || !route || !sample || alerts.length === 0) return;
    // Skip if the sample is the same as last time (avoid re-firing)
    const last = lastSampleRef.current;
    if (last && last.ts === sample.ts) return;
    lastSampleRef.current = sample;

    for (const alert of alerts) {
      if (alert.triggered) continue;
      const stop = route.stops.find((s) => s.id === alert.stopId);
      if (!stop) continue;
      const distanceM = haversine(
        { lat: sample.lat, lng: sample.lng },
        { lat: stop.lat, lng: stop.lng },
      );
      // Hard cap: if you're more than MAX_TRIGGER_DISTANCE_M away, the
      // alert is silent no matter the mode. Prevents firing half a city
      // away when the user picks a long time warning.
      if (distanceM > MAX_TRIGGER_DISTANCE_M) continue;
      if (shouldFire(alert, distanceM, sample.speed)) {
        const etaMin = sample.speed && sample.speed > 0
          ? distanceM / Math.max(sample.speed, ALERT_TRAFFIC_FLOOR_MS) / 60
          : Infinity;
        const distStr = etaMin !== Infinity
          ? `Estás a ${Math.round(etaMin * 60)} s (≈ ${Math.round(distanceM)} m).`
          : `Estás a ${Math.round(distanceM)} m.`;
        void alertUser({
          title: `🔔 ${stop.name} — bájate aquí`,
          body: `${distStr} Pulsa para abrir el viaje.`,
          tag: `stop-alert-${alert.id}`,
          url: '/trip',
          withSound: true,
        });
        void markTriggered(alert.id!);
        setAlerts((cur) => cur.map((a) => (a.id === alert.id ? { ...a, triggered: true } : a)));
      }
    }
  }, [enabled, route, sample, alerts, setAlerts]);

  return {
    alerts,
    reload: () => {
      if (!route) return;
      void listAlertsForRoute(route.id).then((a) => setAlerts(a));
    },
  };
}
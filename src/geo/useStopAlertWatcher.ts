// Stop alert trigger: monitors GPS samples, fires strong alerts when
// the bus is within triggerDistanceM of an alert's stop, and marks the
// alert as triggered so it doesn't fire repeatedly.
//
// Lives in Trip page (or any component that has access to the current
// route + last sample + alert list).

import { useEffect, useRef } from 'react';
import type { GPSSample, Route, Stop } from '@/api/types';
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
      if (distanceM <= alert.triggerDistanceM) {
        // Fire the strong alert
        void alertUser({
          title: `🔔 ${stop.name} — bájate aquí`,
          body: `Estás a ${Math.round(distanceM)} m. Pulsa para abrir el viaje.`,
          tag: `stop-alert-${alert.id}`,
          url: '/trip',
          withSound: true,
        });
        // Mark as triggered so it doesn't fire again this trip
        void markTriggered(alert.id!);
        // Optimistic local update
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
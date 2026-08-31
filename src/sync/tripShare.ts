// Hook that wires trip sharing into the existing WebRTC data channel.
// On the sender side: starts a 60s timer that broadcasts GPS to all
// paired devices.
// On the receiver side: listens for trip-share-* messages and updates
// the sharedTrips store.

import { useEffect } from 'react';
import { useSyncStore } from './index';
import { useTripShareStore } from '@/state/tripShare';
import { useIdentityStore } from '@/state/identity';
import { nearestStop } from '@/geo/distance';
import { notify } from '@/notify';
import type { SyncMessage, Journey } from '@/api/types';

const BROADCAST_INTERVAL_MS = 60_000; // 1 minute

export function useTripShareBridge(opts: {
  /** Active trip, if any. */
  routeId?: string;
  routeName?: string;
  /** Last known planned route, included so the friend knows where you're going. */
  plannedRoute?: Journey | null;
  /** Last GPS sample from the trip. */
  lastSample: { lat: number; lng: number; speed?: number; ts: number } | null;
}) {
  const { routeId, routeName, plannedRoute, lastSample } = opts;
  const sync = useSyncStore();
  const identity = useIdentityStore();
  const outgoing = useTripShareStore((s) => s.outgoing);
  const setOutgoing = useTripShareStore((s) => s.setOutgoing);
  const sharedTrips = useTripShareStore((s) => s.sharedTrips);
  const updateSharedTrip = useTripShareStore((s) => s.updateSharedTrip);

  // Receiver: subscribe to incoming trip-share messages
  useEffect(() => {
    if (!sync || !sync.subscribe) return;
    const handler = (msg: SyncMessage) => {
      if (msg.kind === 'trip-share-start') {
        useTripShareStore.getState().setSharedTrip(msg.fromAnonId, {
          fromAnonId: msg.fromAnonId,
          fromAlias: msg.fromAlias,
          routeId: msg.routeId,
          routeName: msg.routeName,
          plannedRoute: msg.plannedRoute,
          startedAt: msg.startedAt,
        });
        void notify({
          title: `🚌 ${msg.fromAlias ?? msg.fromAnonId.slice(0, 6)} empezó un viaje`,
          body: msg.routeName
            ? `En ${msg.routeName}. Comparte ubicación cada minuto.`
            : 'Comparte ubicación cada minuto.',
          tag: `trip-share-start-${msg.fromAnonId}`,
          url: '/following',
          requireInteraction: true,
        });
      } else if (msg.kind === 'trip-share-location') {
        updateSharedTrip(msg.fromAnonId, {
          lastLocation: { lat: msg.lat, lng: msg.lng, ts: msg.ts, speed: msg.speed },
          nextStopName: msg.nextStopName,
          etaNextStopS: msg.etaNextStopS,
        });
      } else if (msg.kind === 'trip-share-end') {
        updateSharedTrip(msg.fromAnonId, {
          endedAt: msg.ts,
          endReason: msg.reason,
        });
        const trip = sharedTrips[msg.fromAnonId];
        void notify({
          title: `🚌 ${trip?.fromAlias ?? msg.fromAnonId.slice(0, 6)} terminó el viaje`,
          body: `Motivo: ${msg.reason}`,
          tag: `trip-share-end-${msg.fromAnonId}`,
          url: '/following',
        });
      }
    };
    const unsub = sync.subscribe(handler);
    return () => {
      unsub();
    };
  }, [sync, updateSharedTrip, sharedTrips]);

  // Sender: when there's an outgoing trip, broadcast every 60s
  useEffect(() => {
    if (!outgoing || !lastSample) return;
    const anonId = identity.anonId ?? 'me';
    const send = () => {
      if (!sync) return;
      sync.send({
        kind: 'trip-share-location',
        fromAnonId: anonId,
        ts: Date.now(),
        lat: lastSample.lat,
        lng: lastSample.lng,
        speed: lastSample.speed,
      } as SyncMessage);
    };
    // Send immediately
    send();
    const handle = window.setInterval(send, BROADCAST_INTERVAL_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [outgoing !== null, sync, lastSample, identity.anonId]);

  // Imperative API: start/stop sharing
  return {
    /** Begin sharing the current trip with paired devices. Idempotent. */
    startSharing: (plannedRoute?: Journey | null) => {
      if (!identity.anonId) return;
      setOutgoing({
        fromAnonId: identity.anonId,
        fromAlias: 'Yo',
        routeId,
        routeName,
        plannedRoute: plannedRoute ? {
          steps: plannedRoute.steps.map((s) => ({
            kind: s.kind,
            label: s.kind === 'ride'
              ? `${s.routeName}: ${s.fromStopName} → ${s.toStopName}`
              : `Caminar ${Math.round(s.distanceM)} m`,
          })),
          totalDurationS: plannedRoute.totalDurationS,
        } : undefined,
        startedAt: Date.now(),
      });
      if (sync) {
        sync.send({
          kind: 'trip-share-start',
          fromAnonId: identity.anonId,
          fromAlias: 'Yo',
          routeId,
          routeName,
          plannedRoute: plannedRoute ? {
            steps: plannedRoute.steps.map((s) => ({
              kind: s.kind,
              label: s.kind === 'ride'
                ? `${s.routeName}: ${s.fromStopName} → ${s.toStopName}`
                : `Caminar ${Math.round(s.distanceM)} m`,
            })),
            totalDurationS: plannedRoute.totalDurationS,
          } : undefined,
          startedAt: Date.now(),
        } as SyncMessage);
      }
    },
    stopSharing: (reason: string = 'manual') => {
      if (!outgoing) return;
      if (sync) {
        sync.send({
          kind: 'trip-share-end',
          fromAnonId: outgoing.fromAnonId,
          ts: Date.now(),
          reason,
        } as SyncMessage);
      }
      setOutgoing(null);
    },
  };
}

/** Compute next stop name + ETA for a given sample, optionally using the route. */
export function nextStopInfo(
  sample: { lat: number; lng: number; speed?: number },
  stops: Array<{ id: string; name: string; lat: number; lng: number }>,
): { name: string; etaS: number } | null {
  const ns = nearestStop({ lat: sample.lat, lng: sample.lng }, stops);
  if (!ns) return null;
  const stop = stops.find((s) => s.id === ns.stop.id);
  if (!stop) return null;
  const speed = sample.speed && sample.speed > 0.5 ? sample.speed : 8;
  const etaS = ns.distance / speed;
  return { name: stop.name, etaS };
}

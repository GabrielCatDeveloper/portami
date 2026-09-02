// Hook that wires trip sharing into the multi-peer WebRTC data channel
// (Hito 7 — Fase 4).
//
// Thin adapter over `tripShareController`: this hook exists only to
// publish the active trip context into the controller and to give
// the Trip page the imperative API in the shape it expects. The
// always-on background loops (incoming-message handler, location
// broadcast, peer-status retry) live in the controller and are
// installed by `App.tsx` once after identity init — so a WebMCP
// tool can start/stop sharing even when the user is not on the
// /trip page.

import { useEffect } from 'react';
import { tripShareController, type ActiveTripContext } from './tripShareController';
import { nearestStop } from '@/geo/distance';
import type { Journey } from '@/api/types';

export type TripShareBridgeOptions = {
  /** Active trip id, required for persistence. */
  tripId?: string;
  /** Route id. */
  routeId?: string;
  /** Route display name. */
  routeName?: string;
  /** Last known planned route, included so the friend knows where you're going. */
  plannedRoute?: Journey | null;
  /** Most recent GPS sample from the trip. */
  lastSample?: ActiveTripContext['lastSample'];
};

export function useTripShareBridge(opts: TripShareBridgeOptions) {
  const tripId = opts.tripId;
  const routeId = opts.routeId;
  const routeName = opts.routeName ?? '';
  const lastSample = opts.lastSample ?? null;
  const plannedRoute = opts.plannedRoute ?? null;

  useEffect(() => {
    if (!tripId || !routeId) {
      tripShareController.setActiveCtx(null);
      return;
    }
    tripShareController.setActiveCtx({
      tripId,
      routeId,
      routeName,
      plannedRoute,
      lastSample,
    });
    return () => tripShareController.setActiveCtx(null);
    // intentional: the controller's broadcaster reads fresh ctx on each tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, routeId, routeName]);

  return {
    startSharing: tripShareController.startSharing,
    stopSharing: tripShareController.stopSharing,
    retryRecipient: tripShareController.retryRecipient,
    get isSharing() {
      return tripShareController.isSharing();
    },
  };
}

// ------------------------------------------------------------
// Pure helpers (re-exported from the controller for testability
// and to preserve the existing public API surface)
// ------------------------------------------------------------

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

/**
 * Decide what to do with a recipient whose ack timer just fired.
 *
 * - If still in `pending` and the peer is connected: schedule a retry
 *   (caller will re-send start and arm the next attempt).
 * - Otherwise: mark as `failed` with the given error.
 */
export function recipientTimeoutOutcome(args: {
  currentStatus: 'pending' | 'delivered' | 'failed' | 'unreachable';
  isPeerConnected: boolean;
}): { status: 'failed'; error: string } | { status: 'pending'; retry: true } | null {
  if (args.currentStatus !== 'pending') return null;
  if (args.isPeerConnected) return { status: 'pending', retry: true };
  return { status: 'failed', error: 'no ack' };
}

/**
 * Decide what status a recipient should have at the moment of
 * `startSharing()` based on whether the peer is currently connected.
 */
export function initialRecipientStatus(isPeerConnected: boolean): 'pending' | 'unreachable' {
  return isPeerConnected ? 'pending' : 'unreachable';
}

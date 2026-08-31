// Hook that wires trip sharing into the multi-peer WebRTC data channel
// (Hito 7 — Fase 4).
//
// Sender side:
//   - Generates a tripShareId.
//   - Persists an OutgoingTripShare with one recipient row per paired
//     device (status pending if connected, unreachable otherwise).
//   - Broadcasts `trip-share-start` to every connected peer.
//   - Schedules a 10s ack timer per recipient; if no ack arrives, the
//     recipient is retried once (if still connected) then marked failed.
//   - Subscribes to peer-status transitions; when a peer becomes
//     `connected` and there's an active outgoing share, retries the
//     recipient automatically.
//   - Every 60s broadcasts `trip-share-location` to all peers in
//     terminal-positive status (delivered or pending; failed peers
//     don't get locations until they're manually retried).
//
// Receiver side:
//   - On `trip-share-start`: persist IncomingTripShare, update the
//     reactive store, send `trip-share-ack`, fire a notification.
//   - On `trip-share-location`: update lastLocation + eta.
//   - On `trip-share-end`: stamp endedAt + endReason, notify.

import { useEffect, useRef } from 'react';
import { useSyncStore } from './index';
import { useTripShareStore } from '@/state/tripShare';
import { useIdentityStore, useDeviceKeyStore } from '@/state/identity';
import { nearestStop } from '@/geo/distance';
import { notify } from '@/notify';
import {
  putOutgoingShare,
  updateOutgoingRecipient,
  setOutgoingEnded,
  putIncomingShare,
  updateIncomingLocation,
  setIncomingEnded,
  makeRecipient,
  getOutgoingShare,
} from '@/storage/tripSharesStorage';
import type {
  SyncMessage,
  Journey,
  OutgoingTripShare,
  OutgoingTripShareRecipient,
  IncomingTripShare,
} from '@/api/types';

const BROADCAST_INTERVAL_MS = 60_000; // 1 minute
const ACK_TIMEOUT_MS = 10_000; // 10s wait for trip-share-ack (also reused for the retry)

export function useTripShareBridge(opts: {
  /** Active trip id, required for persistence. */
  tripId?: string;
  routeId?: string;
  routeName?: string;
  /** Last known planned route, included so the friend knows where you're going. */
  plannedRoute?: Journey | null;
  /** Last GPS sample from the trip. */
  lastSample: { lat: number; lng: number; speed?: number; ts: number } | null;
}) {
  const { tripId, routeId, routeName, lastSample } = opts;
  const plannedRoute = opts.plannedRoute ?? null;
  const sync = useSyncStore();
  const identity = useIdentityStore();
  const deviceKey = useDeviceKeyStore();

  // Refs to keep mutable per-render state without retriggering effects.
  /** Map of tripShareId → Map<deviceId, timeoutHandle>. */
  const ackTimersRef = useRef<Map<string, Map<string, number>>>(new Map());
  /** Set when sharing is active, to short-circuit per-recipient logic. */
  const activeShareIdRef = useRef<string | null>(null);

  // ------------------------------------------------------------------
  // Receiver: subscribe to incoming trip-share-* messages
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!sync || !sync.subscribe) return;
    const handler = async (msg: SyncMessage, fromDeviceId: string) => {
      if (msg.kind === 'trip-share-start') {
        const incoming: IncomingTripShare = {
          fromAnonId: msg.fromAnonId,
          fromDeviceId: msg.fromDeviceId ?? fromDeviceId,
          fromAlias: msg.fromAlias,
          tripId: msg.tripShareId,
          routeId: msg.routeId,
          routeName: msg.routeName,
          plannedRoute: msg.plannedRoute,
          startedAt: msg.startedAt,
          senderStatus: 'connected',
        };
        await putIncomingShare(incoming);
        useTripShareStore.getState().setSharedTrip(msg.fromAnonId, incoming);

        // Send ack back
        const myAnonId = identity.anonId;
        const myDeviceId = deviceKey.deviceId;
        if (myAnonId && sync.sendTo) {
          sync.sendTo(fromDeviceId, {
            kind: 'trip-share-ack',
            tripShareId: msg.tripShareId,
            recipientAnonId: myAnonId,
            recipientDeviceId: myDeviceId,
            ts: Date.now(),
            ackFor: 'start',
          });
        }

        void notify({
          title: `${msg.fromAlias ?? msg.fromAnonId.slice(0, 6)} empezó un viaje`,
          body: msg.routeName
            ? `En ${msg.routeName}. Comparte ubicación cada minuto.`
            : 'Comparte ubicación cada minuto.',
          tag: `trip-share-start-${msg.fromAnonId}`,
          url: '/following',
          requireInteraction: true,
          actions: [
            { action: 'view', title: 'Ver' },
            { action: 'dismiss', title: 'Cerrar' },
          ],
        });
      } else if (msg.kind === 'trip-share-location') {
        await updateIncomingLocation(
          msg.fromAnonId,
          { lat: msg.lat, lng: msg.lng, ts: msg.ts, speed: msg.speed },
          { nextStopName: msg.nextStopName, etaNextStopS: msg.etaNextStopS },
        );
        useTripShareStore.getState().updateSharedTrip(msg.fromAnonId, {
          lastLocation: { lat: msg.lat, lng: msg.lng, ts: msg.ts, speed: msg.speed },
          nextStopName: msg.nextStopName,
          etaNextStopS: msg.etaNextStopS,
        });
      } else if (msg.kind === 'trip-share-end') {
        await setIncomingEnded(msg.fromAnonId, msg.ts, msg.reason);
        useTripShareStore.getState().updateSharedTrip(msg.fromAnonId, {
          endedAt: msg.ts,
          endReason: msg.reason,
        });
        const trip = useTripShareStore.getState().sharedTrips[msg.fromAnonId];
        void notify({
          title: `${trip?.fromAlias ?? msg.fromAnonId.slice(0, 6)} terminó el viaje`,
          body: `Motivo: ${msg.reason}`,
          tag: `trip-share-end-${msg.fromAnonId}`,
          url: '/following',
        });
      } else if (msg.kind === 'trip-share-ack') {
        // We're the sender: mark recipient as delivered.
        await onAckReceived(msg.tripShareId, msg.recipientDeviceId);
      }
    };
    const unsub = sync.subscribe(handler);
    return () => {
      unsub();
    };
    // `onAckReceived` is defined inside the hook and intentionally
    // not in deps — recreating the subscription on every render
    // would cause missed ack messages during React's commit phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, identity.anonId, deviceKey.deviceId]);

  // ------------------------------------------------------------------
  // Sender: per-peer location broadcast every 60s
  // ------------------------------------------------------------------
  // `isSharing` is read here so the effect re-runs when the user
  // starts/stops sharing. Reading ref.current inline is flagged by
  // the linter as a complex expression in the deps array.
  const isSharing = activeShareIdRef.current !== null;
  useEffect(() => {
    if (!sync || !sync.sendTo) return;
    if (!isSharing || !lastSample) return;
    const anonId = identity.anonId ?? 'me';

    const send = () => {
      const tripShareId = activeShareIdRef.current;
      if (!tripShareId || !sync) return;
      // Use the live store so we get the freshest recipient list.
      const outgoing = useTripShareStore.getState().outgoing;
      if (!outgoing || outgoing.endedAt) return;
      for (const [deviceId, recip] of Object.entries(outgoing.recipients)) {
        // Only send to peers in non-terminal-negative state.
        if (recip.status === 'failed' || recip.status === 'unreachable') continue;
        sync.sendTo(deviceId, {
          kind: 'trip-share-location',
          tripShareId,
          fromAnonId: anonId,
          ts: Date.now(),
          lat: lastSample.lat,
          lng: lastSample.lng,
          speed: lastSample.speed,
        });
      }
    };
    send();
    const handle = window.setInterval(send, BROADCAST_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [isSharing, sync, lastSample, identity.anonId]);

  // ------------------------------------------------------------------
  // Sender: auto-retry when a peer transitions to `connected`
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!sync || !sync.subscribePeerStatus) return;
    const unsub = sync.subscribePeerStatus(async (deviceId, status) => {
      if (status !== 'connected') return;
      const tripShareId = activeShareIdRef.current;
      if (!tripShareId) return;
      const share = await getOutgoingShare(tripShareId);
      if (!share || share.endedAt) return;
      const recip = share.recipients[deviceId];
      if (!recip) return; // not in the recipient list of this share
      if (recip.status === 'delivered' || recip.status === 'pending') return;
      // Recipient is `failed` or `unreachable` — retry.
      await trySendStartToRecipient(share, deviceId, recip);
    });
    return unsub;
    // trySendStartToRecipient is recreated every render (closure over
    // useTripShareStore). Re-subscribing on every render would churn
    // the peer-status stream and is unnecessary — the body reads fresh
    // state via getOutgoingShare / getPeerStatus on each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  // ------------------------------------------------------------------
  // Imperative API: start/stop sharing, retry a specific recipient
  // ------------------------------------------------------------------

  async function startSharing(overrideRoute?: Journey | null): Promise<OutgoingTripShare | null> {
    const myAnonId = identity.anonId;
    const myDeviceId = deviceKey.deviceId;
    if (!myAnonId || !myDeviceId) return null;
    if (!sync) return null;
    if (!tripId) return null;

    // Reuse an existing active share if there is one (e.g. user paused
    // and resumed the same trip). Otherwise create a fresh one.
    const existing = useTripShareStore.getState().outgoing;
    if (existing && !existing.endedAt && existing.tripId === tripId) {
      return existing;
    }

    const finalRoute = overrideRoute ?? plannedRoute;
    const tripShareId = crypto.randomUUID();

    const paired = await sync.loadPairedDevices();
    const recipients: Record<string, OutgoingTripShareRecipient> = {};
    for (const p of paired) {
      recipients[p.deviceId] = makeRecipient(p.deviceId, p.alias);
      // If the peer is currently disconnected, reflect that immediately.
      if (sync.getPeerStatus(p.deviceId) !== 'connected') {
        recipients[p.deviceId].status = 'unreachable';
      }
    }

    const share: OutgoingTripShare = {
      id: tripShareId,
      tripId,
      routeId: routeId ?? '',
      routeName: routeName ?? '',
      plannedRoute: finalRoute
        ? {
            steps: finalRoute.steps.map((s) => ({
              kind: s.kind,
              label:
                s.kind === 'ride'
                  ? `${s.routeName}: ${s.fromStopName} → ${s.toStopName}`
                  : `Caminar ${Math.round(s.distanceM)} m`,
            })),
            totalDurationS: finalRoute.totalDurationS,
          }
        : undefined,
      myAnonId,
      startedAt: Date.now(),
      recipients,
    };
    await putOutgoingShare(share);
    useTripShareStore.getState().setOutgoing(share);
    activeShareIdRef.current = tripShareId;

    // Send start to every connected peer; arm ack timer per peer.
    for (const [deviceId, recip] of Object.entries(recipients)) {
      if (recip.status !== 'unreachable') {
        await trySendStartToRecipient(share, deviceId, recip);
      }
    }
    return share;
  }

  async function stopSharing(reason: string = 'manual'): Promise<void> {
    const tripShareId = activeShareIdRef.current;
    if (!tripShareId) return;
    const outgoing = useTripShareStore.getState().outgoing;
    if (!outgoing) return;

    // Send end to every peer we still consider deliverable.
    if (sync && sync.sendTo) {
      for (const [deviceId, recip] of Object.entries(outgoing.recipients)) {
        if (recip.status === 'delivered' || recip.status === 'pending') {
          sync.sendTo(deviceId, {
            kind: 'trip-share-end',
            tripShareId,
            fromAnonId: outgoing.myAnonId,
            ts: Date.now(),
            reason,
          });
        }
      }
    }

    await setOutgoingEnded(tripShareId, Date.now(), reason);
    clearAckTimers(tripShareId);
    activeShareIdRef.current = null;
    useTripShareStore.getState().setOutgoing(null);
    // Re-hydrate so the zustand cache picks up the `endedAt`.
    void useTripShareStore.getState().hydrate();
  }

  async function retryRecipient(deviceId: string): Promise<void> {
    const tripShareId = activeShareIdRef.current;
    if (!tripShareId) return;
    const share = await getOutgoingShare(tripShareId);
    if (!share || share.endedAt) return;
    const recip = share.recipients[deviceId];
    if (!recip) return;
    if (!sync) return;
    if (sync.getPeerStatus(deviceId) !== 'connected') {
      // No point retrying — peer is offline.
      return;
    }
    await trySendStartToRecipient(share, deviceId, recip, /* forceRetry */ true);
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Send `trip-share-start` to one recipient and arm the ack timeout.
   * Updates the recipient's status in the DB. If the peer isn't
   * connected, marks it `unreachable` (no timer).
   */
  async function trySendStartToRecipient(
    share: OutgoingTripShare,
    deviceId: string,
    recip: OutgoingTripShareRecipient,
    forceRetry = false,
  ): Promise<void> {
    if (!sync) return;
    if (!forceRetry && recip.status === 'delivered') return;
    if (sync.getPeerStatus(deviceId) !== 'connected') {
      await updateOutgoingRecipient(share.id, deviceId, {
        status: 'unreachable',
        lastAttemptAt: Date.now(),
        error: 'peer disconnected',
      });
      useTripShareStore.setState((state) => ({
        outgoing: state.outgoing
          ? {
              ...state.outgoing,
              recipients: {
                ...state.outgoing.recipients,
                [deviceId]: {
                  ...state.outgoing.recipients[deviceId],
                  status: 'unreachable',
                  lastAttemptAt: Date.now(),
                  error: 'peer disconnected',
                },
              },
            }
          : state.outgoing,
      }));
      return;
    }

    sync.sendTo(deviceId, {
      kind: 'trip-share-start',
      tripShareId: share.id,
      fromAnonId: share.myAnonId,
      fromDeviceId: deviceKey.deviceId,
      fromAlias: 'Yo',
      routeId: share.routeId,
      routeName: share.routeName,
      plannedRoute: share.plannedRoute,
      startedAt: share.startedAt,
    });
    await updateOutgoingRecipient(share.id, deviceId, {
      status: 'pending',
      lastAttemptAt: Date.now(),
    });
    useTripShareStore.setState((state) => ({
      outgoing: state.outgoing
        ? {
            ...state.outgoing,
            recipients: {
              ...state.outgoing.recipients,
              [deviceId]: {
                ...state.outgoing.recipients[deviceId],
                status: 'pending',
                lastAttemptAt: Date.now(),
              },
            },
          }
        : state.outgoing,
    }));
    armAckTimer(share.id, deviceId, /* attempt */ 1);
  }

  /** Arm the ack timeout for one recipient. */
  function armAckTimer(tripShareId: string, deviceId: string, attempt: 1 | 2): void {
    clearAckTimer(tripShareId, deviceId);
    let perShare = ackTimersRef.current.get(tripShareId);
    if (!perShare) {
      perShare = new Map();
      ackTimersRef.current.set(tripShareId, perShare);
    }
    const handle = window.setTimeout(async () => {
      const share = await getOutgoingShare(tripShareId);
      if (!share || share.endedAt) return;
      const recip = share.recipients[deviceId];
      if (!recip) return;
      if (recip.status !== 'pending') return; // acked already
      if (attempt === 1) {
        // First timeout — retry once if the peer is still connected.
        if (sync && sync.getPeerStatus(deviceId) === 'connected') {
          await trySendStartToRecipient(share, deviceId, recip);
          return; // trySendStartToRecipient armed a new timer at attempt 2
        }
      }
      // Second timeout or peer offline — give up.
      await updateOutgoingRecipient(tripShareId, deviceId, {
        status: 'failed',
        lastAttemptAt: Date.now(),
        error: attempt === 1 ? 'no ack after retry' : 'no ack',
      });
      useTripShareStore.setState((state) => ({
        outgoing: state.outgoing
          ? {
              ...state.outgoing,
              recipients: {
                ...state.outgoing.recipients,
                [deviceId]: {
                  ...state.outgoing.recipients[deviceId],
                  status: 'failed',
                  lastAttemptAt: Date.now(),
                },
              },
            }
          : state.outgoing,
      }));
    }, ACK_TIMEOUT_MS);
    perShare.set(deviceId, handle);
  }

  function clearAckTimer(tripShareId: string, deviceId: string): void {
    const perShare = ackTimersRef.current.get(tripShareId);
    if (!perShare) return;
    const handle = perShare.get(deviceId);
    if (handle != null) {
      window.clearTimeout(handle);
      perShare.delete(deviceId);
    }
  }

  function clearAckTimers(tripShareId: string): void {
    const perShare = ackTimersRef.current.get(tripShareId);
    if (!perShare) return;
    for (const [, h] of perShare) window.clearTimeout(h);
    ackTimersRef.current.delete(tripShareId);
  }

  /**
   * Called from the receiver-side subscribe loop when we get a
   * `trip-share-ack` (i.e. the friend confirmed they received the
   * start). Marks the recipient `delivered` and clears its timer.
   */
  async function onAckReceived(tripShareId: string, deviceId: string): Promise<void> {
    clearAckTimer(tripShareId, deviceId);
    const share = await getOutgoingShare(tripShareId);
    if (!share) return;
    const recip = share.recipients[deviceId];
    if (!recip) return;
    if (recip.status === 'delivered') return;
    await updateOutgoingRecipient(tripShareId, deviceId, {
      status: 'delivered',
      deliveredAt: Date.now(),
    });
    useTripShareStore.setState((state) => ({
      outgoing: state.outgoing && state.outgoing.id === tripShareId
        ? {
            ...state.outgoing,
            recipients: {
              ...state.outgoing.recipients,
              [deviceId]: {
                ...state.outgoing.recipients[deviceId],
                status: 'delivered',
                deliveredAt: Date.now(),
              },
            },
          }
        : state.outgoing,
    }));
  }

  return {
    startSharing,
    stopSharing,
    retryRecipient,
    /** True iff there's an active outgoing share (started + not ended). */
    get isSharing() {
      return activeShareIdRef.current !== null;
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

// ============================================================
// Pure helpers (testable, no React state)
//
// These encapsulate the policy decisions in a side-effect-free way
// so we can unit-test them without mounting the hook or mocking
// timers + WebRTC together.
// ============================================================

/**
 * Decide what to do with a recipient whose ack timer just fired.
 *
 * - If still in `pending` and the peer is connected: schedule a retry
 *   (caller will re-send start and arm the next attempt).
 * - Otherwise: mark as `failed` with the given error.
 */
export function recipientTimeoutOutcome(args: {
  currentStatus: OutgoingTripShareRecipient['status'];
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
export function initialRecipientStatus(isPeerConnected: boolean): OutgoingTripShareRecipient['status'] {
  return isPeerConnected ? 'pending' : 'unreachable';
}

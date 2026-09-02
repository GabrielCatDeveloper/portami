// ============================================================
// Trip-share controller — singleton that owns the imperative API
// for starting, stopping, and retrying P2P trip shares, plus the
// always-on background loops that need to run for the lifetime
// of the app (incoming-message handler, location broadcast).
//
// Why a singleton (not the existing React hook):
//   - WebMCP tools may invoke start/stop while the user is on any
//     page (not necessarily /trip), so the imperative side must be
//     callable from non-React code paths.
//   - The receiver-side listener and the location broadcaster
//     cannot be tied to a React component's mount lifecycle, or
//     we'd miss incoming shares and stop broadcasting mid-trip
//     whenever the user navigated away from /trip.
//
// How it fits with the existing code:
//   - `useTripShareBridge` (sync/tripShare.ts) becomes a thin
//     adapter that publishes the active trip context into the
//     controller via `setActiveCtx`. The Trip page keeps calling
//     the hook the same way.
//   - `App.tsx` calls `installBackgroundLoops()` once after
//     identity init so the always-on subscribers are active.
// ============================================================

import { useTripShareStore } from '@/state/tripShare';
import { useIdentityStore, useDeviceKeyStore } from '@/state/identity';
import { useSyncStore } from './index';
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

const BROADCAST_INTERVAL_MS = 60_000;
const ACK_TIMEOUT_MS = 10_000;

// ------------------------------------------------------------
// Active trip context (the "what" of the share)
// ------------------------------------------------------------

export type ActiveTripContext = {
  tripId: string;
  routeId: string;
  routeName: string;
  plannedRoute: Journey | null;
  lastSample: { lat: number; lng: number; speed?: number; ts: number } | null;
};

let activeCtx: ActiveTripContext | null = null;
/** tripShareId currently being broadcast, or null when not sharing. */
let activeShareId: string | null = null;
/** per-share ack timers, keyed by tripShareId → deviceId → timeoutHandle. */
const ackTimers = new Map<string, Map<string, number>>();

function getActiveCtx(): ActiveTripContext | null {
  return activeCtx;
}

function setActiveCtx(next: ActiveTripContext | null): void {
  activeCtx = next;
}

// ------------------------------------------------------------
// Public imperative API
// ------------------------------------------------------------

export const tripShareController = {
  getActiveCtx,
  setActiveCtx,
  isSharing(): boolean {
    return activeShareId !== null;
  },
  startSharing,
  stopSharing,
  retryRecipient,
  installBackgroundLoops,
};

// ------------------------------------------------------------
// Imperative: start / stop / retry
// ------------------------------------------------------------

async function startSharing(
  plannedRouteOverride?: Journey | null,
): Promise<OutgoingTripShare | null> {
  const identity = useIdentityStore.getState();
  const deviceKey = useDeviceKeyStore.getState();
  const sync = useSyncStore.getState();

  const myAnonId = identity.anonId;
  const myDeviceId = deviceKey.deviceId;
  if (!myAnonId || !myDeviceId) return null;
  if (!sync) return null;

  const ctx = getActiveCtx();
  if (!ctx?.tripId) return null;

  // Reuse an existing active share if there is one (e.g. user paused
  // and resumed the same trip). Otherwise create a fresh one.
  const existing = useTripShareStore.getState().outgoing;
  if (existing && !existing.endedAt && existing.tripId === ctx.tripId) {
    return existing;
  }

  const finalRoute = plannedRouteOverride ?? ctx.plannedRoute;
  const tripShareId = crypto.randomUUID();

  const paired = await sync.loadPairedDevices();
  const recipients: Record<string, OutgoingTripShareRecipient> = {};
  for (const p of paired) {
    const recip = makeRecipient(p.deviceId, p.alias);
    if (sync.getPeerStatus(p.deviceId) !== 'connected') {
      recip.status = 'unreachable';
    }
    recipients[p.deviceId] = recip;
  }

  const share: OutgoingTripShare = {
    id: tripShareId,
    tripId: ctx.tripId,
    routeId: ctx.routeId ?? '',
    routeName: ctx.routeName ?? '',
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
  activeShareId = tripShareId;

  for (const [deviceId, recip] of Object.entries(recipients)) {
    if (recip.status !== 'unreachable') {
      await trySendStartToRecipient(share, deviceId, recip);
    }
  }
  return share;
}

async function stopSharing(reason: string = 'manual'): Promise<void> {
  const tripShareId = activeShareId;
  if (!tripShareId) return;
  const outgoing = useTripShareStore.getState().outgoing;
  if (!outgoing) return;

  const sync = useSyncStore.getState();
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
  activeShareId = null;
  useTripShareStore.getState().setOutgoing(null);
  // Re-hydrate so the zustand cache picks up the `endedAt`.
  void useTripShareStore.getState().hydrate();
}

async function retryRecipient(deviceId: string): Promise<void> {
  const tripShareId = activeShareId;
  if (!tripShareId) return;
  const share = await getOutgoingShare(tripShareId);
  if (!share || share.endedAt) return;
  const recip = share.recipients[deviceId];
  if (!recip) return;
  const sync = useSyncStore.getState();
  if (!sync) return;
  if (sync.getPeerStatus(deviceId) !== 'connected') return;
  await trySendStartToRecipient(share, deviceId, recip, /* forceRetry */ true);
}

// ------------------------------------------------------------
// Always-on background loops
// ------------------------------------------------------------

function installBackgroundLoops(): () => void {
  const offReceiver = installReceiverListener();
  const offBroadcaster = installLocationBroadcaster();
  const offPeerRetry = installPeerRetrySubscriber();
  return () => {
    offReceiver();
    offBroadcaster();
    offPeerRetry();
  };
}

function installReceiverListener(): () => void {
  const sync = useSyncStore.getState();
  if (!sync || !sync.subscribe) return () => {};
  const identity = useIdentityStore.getState();
  const deviceKey = useDeviceKeyStore.getState();

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
      await onAckReceived(msg.tripShareId, msg.recipientDeviceId);
    } else if (msg.kind === 'trip-share-rescue') {
      useTripShareStore.getState().addRescue({
        rescueId: msg.rescueId,
        fromAnonId: msg.fromAnonId,
        fromDeviceId: msg.fromDeviceId ?? fromDeviceId,
        fromAlias: msg.fromAlias,
        ts: msg.ts,
        lat: msg.lat,
        lng: msg.lng,
        accuracyM: msg.accuracyM,
        message: msg.message,
        acknowledged: false,
      });
      const myAnonId = identity.anonId;
      const myDeviceId = deviceKey.deviceId;
      if (myAnonId && sync.sendTo) {
        sync.sendTo(fromDeviceId, {
          kind: 'trip-share-rescue-ack',
          rescueId: msg.rescueId,
          fromAnonId: myAnonId,
          fromDeviceId: myDeviceId,
          ts: Date.now(),
        });
      }
      void notify({
        title: `🆘 ${msg.fromAlias ?? msg.fromAnonId.slice(0, 6)} necesita ayuda`,
        body: msg.message ?? 'Pulsa para ver la ubicación.',
        tag: `trip-share-rescue-${msg.rescueId}`,
        url: '/following',
        requireInteraction: true,
        actions: [{ action: 'view', title: 'Ver' }],
      });
    }
  };

  const unsub = sync.subscribe(handler);
  return unsub;
}

function installLocationBroadcaster(): () => void {
  // The broadcast reads the live store + ctx on every tick, so a single
  // long-lived interval is enough — no need to reschedule on ctx change.
  const handle = window.setInterval(() => {
    if (!activeShareId) return;
    const ctx = getActiveCtx();
    if (!ctx?.lastSample) return;
    const sync = useSyncStore.getState();
    if (!sync?.sendTo) return;
    const outgoing = useTripShareStore.getState().outgoing;
    if (!outgoing || outgoing.endedAt) return;
    const anonId = useIdentityStore.getState().anonId ?? 'me';
    for (const [deviceId, recip] of Object.entries(outgoing.recipients)) {
      if (recip.status === 'failed' || recip.status === 'unreachable') continue;
      sync.sendTo(deviceId, {
        kind: 'trip-share-location',
        tripShareId: activeShareId,
        fromAnonId: anonId,
        ts: Date.now(),
        lat: ctx.lastSample.lat,
        lng: ctx.lastSample.lng,
        speed: ctx.lastSample.speed,
      });
    }
  }, BROADCAST_INTERVAL_MS);
  return () => window.clearInterval(handle);
}

function installPeerRetrySubscriber(): () => void {
  const sync = useSyncStore.getState();
  if (!sync?.subscribePeerStatus) return () => {};
  return sync.subscribePeerStatus(async (deviceId, status) => {
    if (status !== 'connected') return;
    const tripShareId = activeShareId;
    if (!tripShareId) return;
    const share = await getOutgoingShare(tripShareId);
    if (!share || share.endedAt) return;
    const recip = share.recipients[deviceId];
    if (!recip) return;
    if (recip.status === 'delivered' || recip.status === 'pending') return;
    await trySendStartToRecipient(share, deviceId, recip);
  });
}

// ------------------------------------------------------------
// Internal helpers (ack timers, send logic)
// ------------------------------------------------------------

async function trySendStartToRecipient(
  share: OutgoingTripShare,
  deviceId: string,
  recip: OutgoingTripShareRecipient,
  forceRetry = false,
): Promise<void> {
  const sync = useSyncStore.getState();
  if (!sync) return;
  if (!forceRetry && recip.status === 'delivered') return;
  if (sync.getPeerStatus(deviceId) !== 'connected') {
    await updateOutgoingRecipient(share.id, deviceId, {
      status: 'unreachable',
      lastAttemptAt: Date.now(),
      error: 'peer disconnected',
    });
    patchRecipientInStore(deviceId, {
      status: 'unreachable',
      lastAttemptAt: Date.now(),
      error: 'peer disconnected',
    });
    return;
  }

  const deviceKey = useDeviceKeyStore.getState();
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
  patchRecipientInStore(deviceId, {
    status: 'pending',
    lastAttemptAt: Date.now(),
  });
  armAckTimer(share.id, deviceId, /* attempt */ 1);
}

function armAckTimer(tripShareId: string, deviceId: string, attempt: 1 | 2): void {
  clearAckTimer(tripShareId, deviceId);
  let perShare = ackTimers.get(tripShareId);
  if (!perShare) {
    perShare = new Map();
    ackTimers.set(tripShareId, perShare);
  }
  const handle = window.setTimeout(async () => {
    const share = await getOutgoingShare(tripShareId);
    if (!share || share.endedAt) return;
    const recip = share.recipients[deviceId];
    if (!recip) return;
    if (recip.status !== 'pending') return;
    const sync = useSyncStore.getState();
    if (attempt === 1 && sync?.getPeerStatus(deviceId) === 'connected') {
      await trySendStartToRecipient(share, deviceId, recip);
      return;
    }
    await updateOutgoingRecipient(tripShareId, deviceId, {
      status: 'failed',
      lastAttemptAt: Date.now(),
      error: attempt === 1 ? 'no ack after retry' : 'no ack',
    });
    patchRecipientInStore(deviceId, {
      status: 'failed',
      lastAttemptAt: Date.now(),
    });
  }, ACK_TIMEOUT_MS);
  perShare.set(deviceId, handle);
}

function clearAckTimer(tripShareId: string, deviceId: string): void {
  const perShare = ackTimers.get(tripShareId);
  if (!perShare) return;
  const handle = perShare.get(deviceId);
  if (handle != null) {
    window.clearTimeout(handle);
    perShare.delete(deviceId);
  }
}

function clearAckTimers(tripShareId: string): void {
  const perShare = ackTimers.get(tripShareId);
  if (!perShare) return;
  for (const [, h] of perShare) window.clearTimeout(h);
  ackTimers.delete(tripShareId);
}

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
  patchRecipientInStore(deviceId, {
    status: 'delivered',
    deliveredAt: Date.now(),
  });
}

function patchRecipientInStore(
  deviceId: string,
  patch: Partial<OutgoingTripShareRecipient>,
): void {
  useTripShareStore.setState((state) => {
    const cur = state.outgoing;
    if (!cur) return state;
    const prevRecip = cur.recipients[deviceId];
    if (!prevRecip) return state;
    return {
      outgoing: {
        ...cur,
        recipients: {
          ...cur.recipients,
          [deviceId]: { ...prevRecip, ...patch },
        },
      },
    };
  });
}

// ------------------------------------------------------------
// Pure helpers (re-exported from sync/tripShare.ts for tests)
// ------------------------------------------------------------

/**
 * Decide what to do with a recipient whose ack timer just fired.
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

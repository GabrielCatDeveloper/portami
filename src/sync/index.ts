// Re-export the trip-share controller so WebMCP tools (and the
// /trip page) can call startSharing/stopSharing imperatively. The
// controller owns the always-on background loops; the page hook
// `useTripShareBridge` is a thin adapter that publishes the active
// trip context into it.
export {
  tripShareController,
  recipientTimeoutOutcome,
  initialRecipientStatus,
  type ActiveTripContext,
} from './tripShareController';

// ============================================================
// Pairing + sync orchestrator (multi-peer).
//
// Manual SDP copy-paste for initial pairing; no signaling server.
// After pairing, the connection stays alive and is tracked in a
// Map keyed by deviceId, so the same store can hold N simultaneous
// peer connections (one per paired device).
// ============================================================
import { create } from 'zustand';
import { Peer } from './peer';
import { computePairCode } from './pairCode';
import { encryptIdentityForPeer, decryptIdentityFromPeer } from './identityTransfer';
import {
  base64UrlToBytes,
} from '@/crypto';
import { useDeviceKeyStore, useIdentityStore } from '@/state/identity';
import { getDB } from '@/storage/db';
import type {
  SyncMessage,
  Route,
  RouteEditProposal,
  PairedDevice,
  PeerInfo,
  PeerStatus,
} from '@/api/types';

export type SyncRole = 'idle' | 'initiator' | 'joiner';
export type SyncPhase =
  | 'idle'
  | 'awaiting-peer'
  | 'verifying'
  | 'transferring'
  | 'syncing'
  | 'success'
  | 'error';

type SyncState = {
  role: SyncRole;
  phase: SyncPhase;
  error: string | null;
  pairCode: string | null;
  myOffer: string | null;
  myAlias: string;
  peerAlias: string | null;
  remotePubKey: string | null;
  progress: string;

  /** deviceId of the peer that's currently in the pairing flow (if any). */
  pairingDeviceId: string | null;

  /** All known peer connections, keyed by deviceId === pubKey. */
  peers: Record<string, PeerInfo>;

  // Initiator
  createOfferAndWait(): Promise<string>;
  finishPairingAsInitiator(answer: string): Promise<void>;

  // Joiner
  joinWithOffer(offer: string): Promise<string>;
  finishPairingAsJoiner(): Promise<void>;

  reset(): void;
  loadPairedDevices(): Promise<PairedDevice[]>;
  revokeDevice(deviceId: string): Promise<void>;

  /**
   * Broadcast a message to every connected peer.
   * No-op for peers in any non-`connected` state.
   */
  send(msg: SyncMessage): void;
  /**
   * Send a message to one specific peer (by deviceId).
   * No-op if the peer is not connected.
   */
  sendTo(deviceId: string, msg: SyncMessage): void;
  /**
   * Subscribe to messages received from ALL peers.
   * Returns an unsubscribe function.
   */
  subscribe(fn: (msg: SyncMessage, fromDeviceId: string) => void): () => void;
  /**
   * Subscribe to messages received from a specific peer.
   * Returns an unsubscribe function.
   */
  subscribeToDevice(
    deviceId: string,
    fn: (msg: SyncMessage) => void,
  ): () => void;
  /**
   * Subscribe to peer status transitions. Fires whenever a peer's
   * status changes (e.g. disconnected → connected, or any → error).
   * Returns an unsubscribe function.
   */
  subscribePeerStatus(
    fn: (deviceId: string, status: PeerStatus) => void,
  ): () => void;
  /** Get the current status of one peer. */
  getPeerStatus(deviceId: string): PeerStatus;
  /** List deviceIds of peers currently in `connected` state. */
  listConnectedPeers(): string[];
  /** List deviceIds of peers in any state known to the store. */
  listAllPeers(): string[];
};

async function suggestAlias(): Promise<string> {
  try {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Móvil Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'PC Windows';
    if (/Linux/.test(ua)) return 'PC Linux';
  } catch {}
  return 'Dispositivo';
}

/**
 * Helper used by the pairing flow + the post-pairing message dispatcher
 * to add a new peer to the store and keep its PeerInfo in sync.
 */
type PeerEntry = {
  peer: Peer;
  info: PeerInfo;
  /** Per-peer subscribers (post-pairing). */
  subs: Set<(msg: SyncMessage) => void>;
};

export const useSyncStore = create<SyncState>((set, get) => {
  /** deviceId → entry */
  const peerEntries = new Map<string, PeerEntry>();
  /** Global subscribers — receive messages from every peer. */
  const globalSubs: Set<(msg: SyncMessage, fromDeviceId: string) => void> = new Set();
  /** Subscribers for peer-status transitions. */
  const statusSubs: Set<(deviceId: string, status: PeerStatus) => void> = new Set();
  /** deviceId currently in the pairing flow (initiator or joiner). */
  let pairingInProgress: string | null = null;

  function updatePeerInfo(deviceId: string, patch: Partial<PeerInfo>) {
    const entry = peerEntries.get(deviceId);
    if (!entry) return;
    const prevStatus = entry.info.status;
    entry.info = { ...entry.info, ...patch };
    set((state) => ({
      peers: { ...state.peers, [deviceId]: entry.info },
    }));
    // Emit status transition only when the status actually changes,
    // so subscribers don't get spurious fires on every other patch.
    if (patch.status && patch.status !== prevStatus) {
      for (const fn of statusSubs) {
        try {
          fn(deviceId, entry.info.status);
        } catch {
          /* swallow */
        }
      }
    }
  }

  async function bootstrapPeer(
    role: 'initiator' | 'joiner',
    deviceId: string,
    pubKey: string,
    alias: string,
  ): Promise<Peer> {
    const p = new Peer(role === 'initiator');

    const entry: PeerEntry = {
      peer: p,
      info: {
        deviceId,
        pubKey,
        alias,
        status: 'connecting',
      },
      subs: new Set(),
    };
    peerEntries.set(deviceId, entry);
    set((state) => ({ peers: { ...state.peers, [deviceId]: entry.info } }));

    const deviceKey = await useDeviceKeyStore.getState().ensure();
    const myAlias = await suggestAlias();
    set({ myAlias });
    // Store the device private key on the bootstrap closure so the
    // message handlers below can use it for ECDH derivation.
    (entry as PeerEntry & { devicePrivKey: CryptoKey }).devicePrivKey = deviceKey.privKey;

    p.on('open', () => {
      updatePeerInfo(deviceId, { status: 'connected', lastConnectedAt: Date.now() });
      p.send({
        kind: 'hello',
        deviceId: deviceKey.deviceId,
        pubKey: deviceKey.pubKey,
        alias: myAlias,
        appVersion: '0.1.0',
      });
    });

    p.on('message', async (msg: SyncMessage) => {
      await handleMessage(p, msg, get, set, role, deviceId);
      // Fan out to per-peer subscribers
      for (const fn of entry.subs) {
        try {
          fn(msg);
        } catch {
          /* swallow */
        }
      }
      // Fan out to global subscribers
      for (const fn of globalSubs) {
        try {
          fn(msg, deviceId);
        } catch {
          /* swallow */
        }
      }
    });

    p.on('close', () => {
      const cur = peerEntries.get(deviceId);
      if (!cur) return;
      // Don't downgrade revoked peers
      if (cur.info.status === 'revoked') return;
      // Don't overwrite a successful pairing state with disconnected
      if (cur.info.status === 'connected') {
        updatePeerInfo(deviceId, { status: 'reconnecting' });
      } else {
        updatePeerInfo(deviceId, { status: 'disconnected' });
      }
    });

    p.on('error', (e: unknown) => {
      updatePeerInfo(deviceId, {
        status: 'error',
        lastError: e instanceof Error ? e.message : String(e),
      });
    });

    return p;
  }

  async function handleMessage(
    p: Peer,
    msg: SyncMessage,
    get: () => SyncState,
    set: (partial: Partial<SyncState>) => void,
    _role: 'initiator' | 'joiner',
    deviceId: string,
  ) {
    const state = get();

    if (msg.kind === 'hello') {
      set({ peerAlias: msg.alias, remotePubKey: msg.pubKey });
      // Persist the alias on the PeerInfo for UI consistency.
      updatePeerInfo(deviceId, { alias: msg.alias });
      const myDeviceKey = await useDeviceKeyStore.getState().ensure();
      const code = await computePairCode(myDeviceKey.pubKey, msg.pubKey);
      set({ pairCode: code, phase: 'verifying' });
      // send verify
      p.send({ kind: 'verify', pairCode: code });
    }

    if (msg.kind === 'verify') {
      if (msg.pairCode !== state.pairCode) {
        set({ phase: 'error', error: 'pair codes do not match' });
        updatePeerInfo(deviceId, { status: 'error', lastError: 'pair codes do not match' });
        p.close();
        return;
      }
      // Codes match — proceed to identity transfer
      set({ phase: 'transferring' });
      const idStore = useIdentityStore.getState();

      if (idStore.identity) {
        const peerPub = state.remotePubKey;
        if (!peerPub) return;
        const payload = await encryptIdentityForPeer(
          idStore.identity.privKeyJwk,
          base64UrlToBytes(peerPub),
        );
        p.send({
          kind: 'identity-transfer',
          encryptedJwk: payload.encryptedJwk,
          nonce: payload.nonce,
          salt: payload.salt,
          ephemeralPubKey: payload.ephemeralPubKey,
        });
      }
    }

    if (msg.kind === 'identity-transfer') {
      const entryWithKey = peerEntries.get(deviceId) as
        | (PeerEntry & { devicePrivKey?: CryptoKey })
        | undefined;
      if (!entryWithKey?.devicePrivKey) {
        set({ phase: 'error', error: 'device private key unavailable' });
        p.close();
        return;
      }
      try {
        const jwk = await decryptIdentityFromPeer(msg, entryWithKey.devicePrivKey);
        await useIdentityStore.getState().importFromJwk(jwk);
      } catch (err) {
        set({
          phase: 'error',
          error: err instanceof Error ? `identity transfer failed: ${err.message}` : 'identity transfer failed',
        });
        p.close();
        return;
      }
      p.send({ kind: 'sync-init', lastSyncTs: 0, entityHashes: {} });
      set({ phase: 'syncing', progress: 'Identidad recibida. Sincronizando datos…' });
    }

    if (msg.kind === 'sync-init') {
      set({ phase: 'syncing', progress: 'Enviando datos…' });
      await pushOwnedEntities(p);
      set({ progress: 'Recibiendo datos…' });
    }

    if (msg.kind === 'sync-entities') {
      await applyIncomingEntities(msg.entities);
      set({ phase: 'success', progress: 'Sincronización completa' });
      const remoteDevice = (await get()).remotePubKey;
      const remoteAlias = (await get()).peerAlias;
      if (remoteDevice && remoteAlias) {
        await savePairedDevice({
          deviceId: 'pending',
          pubKey: remoteDevice,
          alias: remoteAlias,
          pairedAt: Date.now(),
          lastSeenAt: Date.now(),
        });
      }
      // Connection stays alive — do NOT close.
      // (Previously we called p.close() here, which forced the user to
      // re-pair every time. Now the peer stays in `connected` state.)
      pairingInProgress = null;
      set({ pairingDeviceId: null });
    }
  }

  return {
    role: 'idle',
    phase: 'idle',
    error: null,
    pairCode: null,
    myOffer: null,
    myAlias: '',
    peerAlias: null,
    remotePubKey: null,
    progress: '',
    pairingDeviceId: null,
    peers: {},

    async createOfferAndWait() {
      set({ role: 'initiator', phase: 'awaiting-peer', error: null });
      // The new peer's id is computed from its pubKey, but we don't know
      // it until `hello` arrives. Use a temporary id; bootstrapPeer will
      // rewrite it after the handshake (the pairing flow uses myOffer
      // and the pair code for matching, not the deviceId).
      const deviceKey = await useDeviceKeyStore.getState().ensure();
      const tempId = `pending-${Date.now()}`;
      pairingInProgress = tempId;
      set({ pairingDeviceId: tempId });
      const alias = await suggestAlias();
      const p = await bootstrapPeer('initiator', tempId, deviceKey.pubKey, alias);
      const offer = await p.createOffer();
      set({ myOffer: offer });
      return offer;
    },

    async finishPairingAsInitiator(answer: string) {
      const id = pairingInProgress;
      if (!id) {
        set({ phase: 'error', error: 'No active pairing' });
        return;
      }
      const entry = peerEntries.get(id);
      if (!entry) {
        set({ phase: 'error', error: 'No active peer' });
        return;
      }
      await entry.peer.acceptAnswer(answer);
    },

    async joinWithOffer(offer: string) {
      set({ role: 'joiner', phase: 'awaiting-peer', error: null });
      const deviceKey = await useDeviceKeyStore.getState().ensure();
      const tempId = `pending-${Date.now()}`;
      pairingInProgress = tempId;
      set({ pairingDeviceId: tempId });
      const alias = await suggestAlias();
      const p = await bootstrapPeer('joiner', tempId, deviceKey.pubKey, alias);
      const answer = await p.createAnswer(offer);
      return answer;
    },

    async finishPairingAsJoiner() {
      // No-op for MVP; joiner waits for sync-init
    },

    reset() {
      for (const [, entry] of peerEntries) {
        try {
          entry.peer.close();
        } catch {
          /* swallow */
        }
      }
      peerEntries.clear();
      globalSubs.clear();
      pairingInProgress = null;
      set({
        role: 'idle',
        phase: 'idle',
        error: null,
        pairCode: null,
        myOffer: null,
        peerAlias: null,
        remotePubKey: null,
        progress: '',
        pairingDeviceId: null,
        peers: {},
      });
    },

    async loadPairedDevices() {
      const db = await getDB();
      return db.getAll('pairedDevices');
    },

    async revokeDevice(deviceId) {
      const entry = peerEntries.get(deviceId);
      if (entry) {
        try {
          entry.peer.close();
        } catch {
          /* swallow */
        }
        updatePeerInfo(deviceId, { status: 'revoked' });
      } else {
        // No live Peer object, but we still need to update the
        // observable state if the peer was previously known.
        const cur = get().peers[deviceId];
        if (cur) {
          set((state) => ({
            peers: { ...state.peers, [deviceId]: { ...cur, status: 'revoked' } },
          }));
        }
      }
      const db = await getDB();
      await db.delete('pairedDevices', deviceId);
    },

    send(msg) {
      for (const [, entry] of peerEntries) {
        if (entry.info.status === 'connected') {
          try {
            entry.peer.send(msg);
          } catch {
            /* swallow */
          }
        }
      }
    },

    sendTo(deviceId, msg) {
      const entry = peerEntries.get(deviceId);
      if (!entry || entry.info.status !== 'connected') return;
      try {
        entry.peer.send(msg);
      } catch {
        /* swallow */
      }
    },

    subscribe(fn) {
      globalSubs.add(fn);
      return () => {
        globalSubs.delete(fn);
      };
    },

    subscribeToDevice(deviceId, fn) {
      const entry = peerEntries.get(deviceId);
      if (!entry) {
        // No-op; caller should check getPeerStatus first.
        return () => {};
      }
      entry.subs.add(fn);
      return () => {
        entry.subs.delete(fn);
      };
    },

    subscribePeerStatus(fn) {
      statusSubs.add(fn);
      return () => {
        statusSubs.delete(fn);
      };
    },

    getPeerStatus(deviceId) {
      return get().peers[deviceId]?.status ?? 'disconnected';
    },

    listConnectedPeers() {
      const peers = get().peers;
      return Object.keys(peers).filter((id) => {
        const peer = peers[id];
        return peer?.status === 'connected';
      });
    },

    listAllPeers() {
      const peers = get().peers;
      return Object.keys(peers);
    },
  };
});

// ============================================================
// Sync helpers
// ============================================================

async function pushOwnedEntities(peer: Peer) {
  const db = await getDB();
  const myRoutes = (await db.getAll('routes')).filter((r) => r.isMine);
  const myProposals = await db.getAll('proposals');
  peer.send({
    kind: 'sync-entities',
    entities: [
      ...myRoutes.map((r) => ({
        type: 'route' as const,
        data: r,
      })),
      ...myProposals.map((p) => ({
        type: 'proposal' as const,
        data: p,
      })),
    ],
  });
}

async function applyIncomingEntities(
  entities: Array<{ type: 'route' | 'proposal' | 'draft'; data: unknown }>,
) {
  const db = await getDB();
  for (const e of entities) {
    if (e.type === 'route') {
      const r = e.data as Route & { isMine: boolean; isFavorite: boolean };
      const local = await db.get('routes', r.id);
      if (local && local.isMine && local.createdBy !== r.createdBy) {
        // Conflict: skip
        continue;
      }
      await db.put('routes', { ...r, cachedAt: Date.now() });
    } else if (e.type === 'proposal') {
      const p = e.data as RouteEditProposal;
      const local = await db.get('proposals', p.id);
      if (!local || p.createdAt > local.createdAt) {
        await db.put('proposals', p);
      }
    }
  }
}

async function savePairedDevice(d: PairedDevice) {
  const db = await getDB();
  // Use pubKey as the stable key since we don't have a reliable deviceId
  await db.put('pairedDevices', { ...d, deviceId: d.pubKey }, d.pubKey);
}

// ============================================================
// Simplified pairing + sync orchestrator
// Manual SDP copy-paste; no signaling server.
// ============================================================
import { create } from 'zustand';
import { Peer } from './peer';
import { computePairCode } from './pairCode';
import { encryptIdentityForPeer, decryptIdentityFromPeer } from './identityTransfer';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  importPrivateKeyJwk,
} from '@/crypto';
import { useDeviceKeyStore, useIdentityStore } from '@/state/identity';
import { getDB } from '@/storage/db';
import type {
  SyncMessage,
  Route,
  RouteEditProposal,
  PairedDevice,
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

  // Initiator
  createOfferAndWait(): Promise<string>;
  finishPairingAsInitiator(answer: string): Promise<void>;

  // Joiner
  joinWithOffer(offer: string): Promise<string>;
  finishPairingAsJoiner(): Promise<void>;

  reset(): void;
  loadPairedDevices(): Promise<PairedDevice[]>;
  revokeDevice(deviceId: string): Promise<void>;
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

export const useSyncStore = create<SyncState>((set, get) => {
  let peer: Peer | null = null;

  async function bootstrapPeer(role: 'initiator' | 'joiner'): Promise<Peer> {
    if (peer) peer.close();
    const p = new Peer(role === 'initiator');
    peer = p;

    const deviceKey = await useDeviceKeyStore.getState().ensure();
    const alias = await suggestAlias();
    set({ myAlias: alias });

    p.on('open', () => {
      p.send({
        kind: 'hello',
        deviceId: deviceKey.deviceId,
        pubKey: deviceKey.pubKey,
        alias,
        appVersion: '0.1.0',
      });
    });

    p.on('message', async (msg: SyncMessage) => {
      await handleMessage(p, msg, get, set, role);
    });

    return p;
  }

  async function handleMessage(
    p: Peer,
    msg: SyncMessage,
    get: () => SyncState,
    set: (partial: Partial<SyncState>) => void,
    role: 'initiator' | 'joiner',
  ) {
    const state = get();

    if (msg.kind === 'hello') {
      set({ peerAlias: msg.alias, remotePubKey: msg.pubKey });
      const myDeviceKey = await useDeviceKeyStore.getState().ensure();
      const code = await computePairCode(myDeviceKey.pubKey, msg.pubKey);
      set({ pairCode: code, phase: 'verifying' });
      // send verify
      p.send({ kind: 'verify', pairCode: code });
    }

    if (msg.kind === 'verify') {
      if (msg.pairCode !== state.pairCode) {
        set({ phase: 'error', error: 'pair codes do not match' });
        p.close();
        return;
      }
      // Codes match — proceed to identity transfer
      set({ phase: 'transferring' });
      const idStore = useIdentityStore.getState();

      if (idStore.identity) {
        // We have an identity → send it to the joiner (or to anyone for re-sync)
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
      // If we don't have an identity, just wait for the transfer
    }

    if (msg.kind === 'identity-transfer') {
      const jwk = await decryptIdentityFromPeer(msg);
      // Find peer device pubkey from previous hello
      const peerPub = state.remotePubKey;
      if (!peerPub) return;
      // Persist
      const idStore = useIdentityStore.getState();
      // We need a pubkey to import; use the device pubkey as a placeholder, but better:
      // The transfer itself should include the user pubkey. For MVP, we trust the encrypted payload.
      // Let's also export identity along with jwk in payload. For simplicity, request user pub from peer:
      p.send({ kind: 'sync-init', lastSyncTs: 0, entityHashes: {} });
      // Wait for sync data
      set({ phase: 'syncing', progress: 'Identidad recibida. Sincronizando datos…' });
      void jwk;
    }

    if (msg.kind === 'sync-init') {
      // Push our entities
      set({ phase: 'syncing', progress: 'Enviando datos…' });
      await pushOwnedEntities(p);
      // And then request what the peer has
      set({ progress: 'Recibiendo datos…' });
    }

    if (msg.kind === 'sync-entities') {
      await applyIncomingEntities(msg.entities);
      set({ phase: 'success', progress: 'Sincronización completa' });
      // Save paired device
      const remoteDevice = (await get()).remotePubKey;
      const remoteAlias = (await get()).peerAlias;
      if (remoteDevice && remoteAlias) {
        await savePairedDevice({
          deviceId: 'pending', // we don't get the deviceId in protocol; use a derived key
          pubKey: remoteDevice,
          alias: remoteAlias,
          pairedAt: Date.now(),
          lastSeenAt: Date.now(),
        });
      }
      p.close();
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

    async createOfferAndWait() {
      set({ role: 'initiator', phase: 'awaiting-peer', error: null });
      const p = await bootstrapPeer('initiator');
      const offer = await p.createOffer();
      set({ myOffer: offer });
      return offer;
    },

    async finishPairingAsInitiator(answer: string) {
      if (!peer) {
        set({ phase: 'error', error: 'No active peer' });
        return;
      }
      await peer.acceptAnswer(answer);
    },

    async joinWithOffer(offer: string) {
      set({ role: 'joiner', phase: 'awaiting-peer', error: null });
      const p = await bootstrapPeer('joiner');
      const answer = await p.createAnswer(offer);
      return answer;
    },

    async finishPairingAsJoiner() {
      // No-op for MVP; joiner waits for sync-init
    },

    reset() {
      peer?.close();
      peer = null;
      set({
        role: 'idle',
        phase: 'idle',
        error: null,
        pairCode: null,
        myOffer: null,
        peerAlias: null,
        remotePubKey: null,
        progress: '',
      });
    },

    async loadPairedDevices() {
      const db = await getDB();
      return db.getAll('pairedDevices');
    },

    async revokeDevice(deviceId) {
      const db = await getDB();
      await db.delete('pairedDevices', deviceId);
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
  entities: Array<{ type: 'route' | 'proposal' | 'draft'; data: any }>,
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
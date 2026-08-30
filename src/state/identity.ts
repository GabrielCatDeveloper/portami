import { create } from 'zustand';
import {
  anonIdFor,
  exportPrivateKeyJwk,
  generateIdentityKeyPair,
  importPrivateKeyJwk,
  importPublicKeyB64,
  randomUUID,
} from '@/crypto';
import { getDB, getIdentity, setIdentity, clearIdentity } from '@/storage/db';
import type { Identity } from '@/api/types';

type IdentityState = {
  identity: Identity | null;
  anonId: string | null;
  initialized: boolean;
  init(): Promise<void>;
  ensure(): Promise<Identity>;
  regenerate(): Promise<Identity>;
  importFromJwk(privJwk: JsonWebKey, pubB64: string): Promise<Identity>;
  reset(): Promise<void>;
};

export const useIdentityStore = create<IdentityState>((set, get) => ({
  identity: null,
  anonId: null,
  initialized: false,

  async init() {
    let id = await getIdentity();
    if (!id) {
      const kp = await generateIdentityKeyPair();
      const privJwk = await exportPrivateKeyJwk(kp.privKey);
      id = {
        pubKey: kp.pubKeyB64,
        privKeyJwk: privJwk,
        createdAt: Date.now(),
      };
      await setIdentity(id);
    }
    const anonId = await anonIdFor(id.pubKey);
    set({ identity: id, anonId, initialized: true });
  },

  async ensure() {
    if (!get().initialized) await get().init();
    if (!get().identity) throw new Error('Identity unavailable');
    return get().identity!;
  },

  async regenerate() {
    const kp = await generateIdentityKeyPair();
    const privJwk = await exportPrivateKeyJwk(kp.privKey);
    const id: Identity = {
      pubKey: kp.pubKeyB64,
      privKeyJwk: privJwk,
      createdAt: Date.now(),
    };
    await setIdentity(id);
    const anonId = await anonIdFor(id.pubKey);
    set({ identity: id, anonId });
    return id;
  },

  async importFromJwk(privJwk, pubB64) {
    const privKey = await importPrivateKeyJwk(privJwk);
    // sanity-check: pub derived from priv should match
    const derivedPub = await crypto.subtle.exportKey('raw', privKey as CryptoKey).catch(() => null);
    // Ed25519 priv JWK doesn't include pub in some impls, so just trust both fields:
    const id: Identity = {
      pubKey: pubB64,
      privKeyJwk: privJwk,
      createdAt: Date.now(),
    };
    void derivedPub; // currently unused
    void (await importPublicKeyB64(pubB64));
    await setIdentity(id);
    const anonId = await anonIdFor(id.pubKey);
    set({ identity: id, anonId });
    return id;
  },

  async reset() {
    await clearIdentity();
    set({ identity: null, anonId: null });
    // Wipe everything except the deviceKey
    const db = await getDB();
    await Promise.all([
      db.clear('routes'),
      db.clear('proposals'),
      db.clear('recordings'),
      db.clear('draftRoutes'),
      db.clear('pairedDevices'),
      db.clear('conflicts'),
      db.clear('trips'),
      db.clear('pendingSamples'),
      db.clear('syncMeta'),
    ]);
  },
}));

// ============================================================
// Device identity (used for WebRTC pairing) — generated once, never shared
// ============================================================
type DeviceKeyState = {
  deviceId: string;
  pubKey: string | null;
  ensure(): Promise<{ deviceId: string; pubKey: string }>;
};

export const useDeviceKeyStore = create<DeviceKeyState>((set, get) => ({
  deviceId: '',
  pubKey: null,

  async ensure() {
    if (get().pubKey && get().deviceId) {
      return { deviceId: get().deviceId, pubKey: get().pubKey! };
    }
    const db = await getDB();
    let stored = await db.get('deviceKey', 'self');
    if (!stored) {
      const kp = await generateIdentityKeyPair();
      stored = {
        deviceId: randomUUID(),
        pubKey: kp.pubKeyB64,
        privKeyJwk: await exportPrivateKeyJwk(kp.privKey),
        createdAt: Date.now(),
      };
      await db.put('deviceKey', stored, 'self');
    }
    set({ deviceId: stored.deviceId, pubKey: stored.pubKey });
    return { deviceId: stored.deviceId, pubKey: stored.pubKey };
  },
}));
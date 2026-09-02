import { create } from 'zustand';
import {
  anonIdFor,
  bytesToBase64Url,
  exportPrivateKeyJwk,
  generateIdentityKeyPair,
  generateEcdh,
  importPrivateKeyJwk,
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
  /** Import an identity from a JWK (private key). The public key is
   *  derived from the JWK itself, so callers don't need to pass it
   *  — this prevents pairing a private key with a forged public key. */
  importFromJwk(privJwk: JsonWebKey): Promise<Identity>;
  reset(): Promise<void>;
};

/** Derive the base64url Ed25519 public key from a private JWK. */
async function pubFromJwk(privJwk: JsonWebKey): Promise<string> {
  const priv = await importPrivateKeyJwk(privJwk);
  const jwk = await crypto.subtle.exportKey('jwk', priv);
  if (!jwk.x) {
    throw new Error('JWK no contiene clave pública (x). ¿Formato corrupto?');
  }
  return jwk.x;
}

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
    const id = get().identity;
    if (!id) throw new Error('Identity unavailable');
    return id;
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

  async importFromJwk(privJwk) {
    const pubKey = await pubFromJwk(privJwk);
    const id: Identity = {
      pubKey,
      privKeyJwk: privJwk,
      createdAt: Date.now(),
    };
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
// Device key (used for WebRTC pairing + ECDH identity transfer).
//
// Unlike the user identity (Ed25519), the device key is an
// ECDH P-256 keypair: it's used both to identify the device in
// the `hello` message and to derive the shared secret that
// protects the user's Ed25519 identity during the initial
// pairing. The private key never leaves the device.
// ============================================================
type DeviceKeyState = {
  deviceId: string;
  pubKey: string | null;
  /** Loaded device ECDH private key (CryptoKey). Cleared from cache
   *  on identity reset — re-loaded on next `ensure()`. */
  privKey: CryptoKey | null;
  ensure(): Promise<{ deviceId: string; pubKey: string; privKey: CryptoKey }>;
};

export const useDeviceKeyStore = create<DeviceKeyState>((set, get) => ({
  deviceId: '',
  pubKey: null,
  privKey: null,

  async ensure() {
    const cur = get();
    if (cur.pubKey && cur.deviceId && cur.privKey) {
      return { deviceId: cur.deviceId, pubKey: cur.pubKey, privKey: cur.privKey };
    }
    const db = await getDB();
    let stored = await db.get('deviceKey', 'self');
    if (!stored) {
      const kp = await generateEcdh();
      stored = {
        deviceId: randomUUID(),
        pubKey: bytesToBase64Url(kp.pubRaw),
        privKeyJwk: await crypto.subtle.exportKey('jwk', kp.privKey),
        createdAt: Date.now(),
      };
      await db.put('deviceKey', stored, 'self');
    }
    const privKey = await crypto.subtle.importKey(
      'jwk',
      stored.privKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );
    set({ deviceId: stored.deviceId, pubKey: stored.pubKey, privKey });
    return { deviceId: stored.deviceId, pubKey: stored.pubKey, privKey };
  },
}));
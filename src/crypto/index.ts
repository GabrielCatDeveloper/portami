// ============================================================
// Crypto utilities for portami
// Ed25519 identity, signing, anonId derivation
// ============================================================

const ED25519 = { name: 'Ed25519' } as const;

// TS 5.6+: Uint8Array<ArrayBufferLike> isn't assignable to BufferSource.
// Cast to BufferSource explicitly to satisfy the type checker.
function buf(arr: Uint8Array): BufferSource {
  return arr as unknown as BufferSource;
}

// ============================================================
// Encoding helpers
// ============================================================
export function bytesToBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const b64padded = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase32(bytes: Uint8Array): string {
  const ALPH = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}

// ============================================================
// Canonical JSON
// ============================================================
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalJSON((value as Record<string, unknown>)[k]))
    .join(',') + '}';
}

// ============================================================
// SHA-256 helpers
// ============================================================
export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const out = await crypto.subtle.digest('SHA-256', buf(data));
  return new Uint8Array(out);
}

export async function sha256Base64Url(input: string | Uint8Array): Promise<string> {
  return bytesToBase64Url(await sha256(input));
}

// ============================================================
// Identity (Ed25519)
// ============================================================
export type KeyPairHandle = {
  pubKey: Uint8Array;
  privKey: CryptoKey;
  pubKeyB64: string;
};

export async function generateIdentityKeyPair(): Promise<KeyPairHandle> {
  const kp = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return {
    pubKey: rawPub,
    privKey: kp.privateKey,
    pubKeyB64: bytesToBase64Url(rawPub),
  };
}

export async function exportPublicKeyB64(pubKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pubKey));
  return bytesToBase64Url(raw);
}

export async function importPublicKeyB64(b64: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(b64);
  return crypto.subtle.importKey('raw', buf(raw), ED25519, true, ['verify']);
}

export async function exportPrivateKeyJwk(privKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', privKey);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ED25519, true, ['sign']);
}

// ============================================================
// Signing
// ============================================================
export async function signMessage(privKey: CryptoKey, message: Uint8Array): Promise<string> {
  const sig = await crypto.subtle.sign(ED25519, privKey, buf(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function verifySignature(
  pubKey: CryptoKey | string,
  message: Uint8Array,
  sigB64: string,
): Promise<boolean> {
  const key = typeof pubKey === 'string' ? await importPublicKeyB64(pubKey) : pubKey;
  const sig = base64UrlToBytes(sigB64);
  return crypto.subtle.verify(ED25519, key, buf(sig), buf(message));
}

// ============================================================
// Anon ID
// ============================================================
const CACHE: Record<string, string> = {};
export async function anonIdFor(pubKeyB64: string): Promise<string> {
  if (CACHE[pubKeyB64]) return CACHE[pubKeyB64];
  const hash = await sha256(base64UrlToBytes(pubKeyB64));
  const b32 = bytesToBase32(hash).slice(0, 8);
  const formatted = `${b32.slice(0, 4)}-${b32.slice(4, 8)}`.toUpperCase();
  CACHE[pubKeyB64] = formatted;
  return formatted;
}

// ============================================================
// Random
// ============================================================
export function randomNonce(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToBase64Url(arr);
}

export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC4122 v4 fallback
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ============================================================
// ECDH for identity transfer (WebRTC pairing)
// ============================================================
export type EcdhKeyPair = { privKey: CryptoKey; pubKey: CryptoKey; pubRaw: Uint8Array };

export async function generateEcdh(): Promise<EcdhKeyPair> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { privKey: kp.privateKey, pubKey: kp.publicKey, pubRaw: raw };
}

export async function importEcdhPub(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(raw), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

export async function deriveSharedAesKey(
  privKey: CryptoKey,
  otherPubKey: CryptoKey,
  salt: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: otherPubKey },
    privKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
void deriveSharedAesKey;

// AES-GCM helpers for identity transfer
export async function aesEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(plaintext)));
  return { ciphertext: ct, nonce };
}

export async function aesDecrypt(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(ciphertext)),
  );
}

// PBKDF2 for backup passphrase
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    buf(new TextEncoder().encode(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: 600_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Feature detection
export async function isEd25519Supported(): Promise<boolean> {
  try {
    const kp = await crypto.subtle.generateKey(ED25519, false, ['sign']);
    return !!kp.privateKey;
  } catch {
    return false;
  }
}
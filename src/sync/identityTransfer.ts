// ============================================================
// Identity transfer over WebRTC using ECDH + AES-GCM
// ============================================================
import {
  generateEcdh,
  importEcdhPub,
  deriveSharedAesKey,
  aesEncrypt,
  aesDecrypt,
  importPrivateKeyJwk,
  bytesToBase64Url,
  base64UrlToBytes,
} from '@/crypto';

export type IdentityTransferPayload = {
  encryptedJwk: string;
  nonce: string;
  salt: string;
  ephemeralPubKey: string;
};

export async function encryptIdentityForPeer(
  privJwk: JsonWebKey,
  receiverPubRaw: Uint8Array,
): Promise<IdentityTransferPayload> {
  const eph = await generateEcdh();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const sharedKey = await deriveSharedAesKey(eph.privKey, await importEcdhPub(receiverPubRaw), salt);
  const privBytes = new TextEncoder().encode(JSON.stringify(privJwk));
  const { ciphertext, nonce } = await aesEncrypt(sharedKey, privBytes);
  return {
    encryptedJwk: bytesToBase64Url(ciphertext),
    nonce: bytesToBase64Url(nonce),
    salt: bytesToBase64Url(salt),
    ephemeralPubKey: bytesToBase64Url(eph.pubRaw),
  };
}

export async function decryptIdentityFromPeer(
  payload: IdentityTransferPayload,
): Promise<JsonWebKey> {
  const eph = await generateEcdh();
  const salt = base64UrlToBytes(payload.salt);
  const sharedKey = await deriveSharedAesKey(
    eph.privKey,
    await importEcdhPub(base64UrlToBytes(payload.ephemeralPubKey)),
    salt,
  );
  const ct = base64UrlToBytes(payload.encryptedJwk);
  const nonce = base64UrlToBytes(payload.nonce);
  const plaintext = await aesDecrypt(sharedKey, ct, nonce);
  return JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
}
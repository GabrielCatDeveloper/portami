// ============================================================
// Identity transfer over WebRTC using ECDH + AES-GCM.
//
// Protocol:
//   - Both sides hold a stable device ECDH key (useDeviceKeyStore).
//   - Sender: ephemeral keypair; encrypts with shared secret derived
//     from (eph.privKey, receiverDevicePubKey).
//   - Receiver: derives shared secret from (deviceKey.privKey,
//     senderEphemeralPubKey). Same shared secret → decrypts the
//     sender's identity JWK.
//
// The `salt` field was carried over from an earlier draft but is
// intentionally not used — `deriveSharedAesKey` derives the AES key
// directly from the ECDH shared secret (no PBKDF2), so adding a salt
// on the wire would be misleading. It is kept in the payload only
// for forward compatibility (see IdentityTransferPayload).
// ============================================================
import {
  generateEcdh,
  importEcdhPub,
  deriveSharedAesKey,
  aesEncrypt,
  aesDecrypt,
  bytesToBase64Url,
  base64UrlToBytes,
} from '@/crypto';

export type IdentityTransferPayload = {
  encryptedJwk: string;
  nonce: string;
  /** Reserved for future use (PBKDF2 over the shared secret). Currently unused. */
  salt: string;
  ephemeralPubKey: string;
};

export async function encryptIdentityForPeer(
  privJwk: JsonWebKey,
  receiverDevicePubRaw: Uint8Array,
): Promise<IdentityTransferPayload> {
  const eph = await generateEcdh();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const sharedKey = await deriveSharedAesKey(
    eph.privKey,
    await importEcdhPub(receiverDevicePubRaw),
  );
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
  receiverDevicePrivKey: CryptoKey,
): Promise<JsonWebKey> {
  const sharedKey = await deriveSharedAesKey(
    receiverDevicePrivKey,
    await importEcdhPub(base64UrlToBytes(payload.ephemeralPubKey)),
  );
  const ct = base64UrlToBytes(payload.encryptedJwk);
  const nonce = base64UrlToBytes(payload.nonce);
  const plaintext = await aesDecrypt(sharedKey, ct, nonce);
  return JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
}
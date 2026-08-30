import { describe, it, expect } from 'vitest';
import { computePairCode } from '@/sync/pairCode';
import { generateEcdh, deriveSharedAesKey } from '@/crypto';

describe('pairCode', () => {
  it('is symmetric and deterministic', async () => {
    const code1 = await computePairCode('pubkey-aaa', 'pubkey-bbb');
    const code2 = await computePairCode('pubkey-bbb', 'pubkey-aaa');
    expect(code1).toBe(code2);
  });

  it('differs for different pairs', async () => {
    const a = await computePairCode('pubkey-aaa', 'pubkey-bbb');
    const b = await computePairCode('pubkey-ccc', 'pubkey-ddd');
    expect(a).not.toBe(b);
  });

  it('is exactly 6 chars', async () => {
    const code = await computePairCode('x', 'y');
    expect(code.length).toBe(6);
  });
});

describe('identityTransfer', () => {
  it('round-trips JWK via ECDH + AES-GCM', async () => {
    // Simulate "Alice" (sender) and "Bob" (receiver) ECDH keys
    const alice = await generateEcdh();
    const bob = await generateEcdh();

    // Sender side: encrypt using Alice priv + Bob pub
    const jwk: JsonWebKey = {
      kty: 'OKP',
      crv: 'Ed25519',
      d: 'mock-private-key-bytes',
      x: 'mock-public-key-bytes',
      key_ops: ['sign'],
      ext: true,
    };
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const sharedA = await deriveSharedAesKey(alice.privKey, bob.pubKey, salt);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(12) },
        sharedA,
        new TextEncoder().encode(JSON.stringify(jwk)),
      ),
    );

    // Receiver side: derive same key using Bob priv + Alice pub, decrypt
    const sharedB = await deriveSharedAesKey(bob.privKey, alice.pubKey, salt);
    const pt = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(12) },
        sharedB,
        ct,
      ),
    );
    const decoded = JSON.parse(new TextDecoder().decode(pt));
    expect(decoded.kty).toBe('OKP');
    expect(decoded.d).toBe('mock-private-key-bytes');
  });

  it('encrypt/decrypt helpers produce valid ciphertext', async () => {
    const a = await generateEcdh();
    const b = await generateEcdh();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const sharedA = await deriveSharedAesKey(a.privKey, b.pubKey, salt);

    const plaintext = new TextEncoder().encode('secret-message-123');
    const { ciphertext, nonce } = await (await import('@/crypto')).aesEncrypt(sharedA, plaintext);

    // Try to decrypt with the matching side
    const sharedB = await deriveSharedAesKey(b.privKey, a.pubKey, salt);
    const pt = await (await import('@/crypto')).aesDecrypt(sharedB, ciphertext, nonce);
    expect(new TextDecoder().decode(pt)).toBe('secret-message-123');
  });
});
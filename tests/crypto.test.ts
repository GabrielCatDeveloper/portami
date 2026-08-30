import { describe, it, expect } from 'vitest';
import {
  generateIdentityKeyPair,
  signMessage,
  verifySignature,
  importPublicKeyB64,
  anonIdFor,
  canonicalJSON,
  bytesToBase64Url,
  base64UrlToBytes,
  randomNonce,
  randomUUID,
  sha256,
  bytesToBase32,
} from '@/crypto';

describe('crypto utilities', () => {
  it('round-trips base64url', () => {
    const original = new Uint8Array([0, 1, 2, 3, 250, 251, 254, 255]);
    const encoded = bytesToBase64Url(original);
    const decoded = base64UrlToBytes(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('produces consistent anonId for same pubKey', async () => {
    const a = await anonIdFor('test-key-aaa');
    const b = await anonIdFor('test-key-aaa');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('produces different anonIds for different keys', async () => {
    const a = await anonIdFor('test-key-aaa');
    const b = await anonIdFor('test-key-bbb');
    expect(a).not.toBe(b);
  });

  it('generates valid Ed25519 signatures', async () => {
    const kp = await generateIdentityKeyPair();
    const msg = new TextEncoder().encode('hello world');
    const sig = await signMessage(kp.privKey, msg);
    const valid = await verifySignature(kp.pubKeyB64, msg, sig);
    expect(valid).toBe(true);
  });

  it('rejects tampered signatures', async () => {
    const kp = await generateIdentityKeyPair();
    const msg = new TextEncoder().encode('hello');
    const sig = await signMessage(kp.privKey, msg);
    const tampered = new TextEncoder().encode('hellp');
    const valid = await verifySignature(kp.pubKeyB64, tampered, sig);
    expect(valid).toBe(false);
  });

  it('imports a foreign public key and verifies', async () => {
    const a = await generateIdentityKeyPair();
    const b = await generateIdentityKeyPair();
    const msg = new TextEncoder().encode('cross');
    const sig = await signMessage(a.privKey, msg);
    const importedA = await importPublicKeyB64(a.pubKeyB64);
    expect(await verifySignature(importedA, msg, sig)).toBe(true);
    expect(await verifySignature(b.pubKeyB64, msg, sig)).toBe(false);
  });

  it('canonicalJSON orders keys deterministically', () => {
    expect(canonicalJSON({ b: 2, a: 1 })).toBe(canonicalJSON({ a: 1, b: 2 }));
  });

  it('canonicalJSON handles nested objects', () => {
    const x = { a: { d: 1, c: 2 }, b: [3, { f: 5, e: 4 }] };
    const y = { b: [3, { e: 4, f: 5 }], a: { c: 2, d: 1 } };
    expect(canonicalJSON(x)).toBe(canonicalJSON(y));
  });

  it('randomNonce produces unique strings', () => {
    const a = randomNonce();
    const b = randomNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(15);
  });

  it('randomUUID returns valid UUID format', () => {
    const u = randomUUID();
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sha256 returns consistent hashes', async () => {
    const h1 = await sha256('hello');
    const h2 = await sha256('hello');
    expect(Array.from(h1)).toEqual(Array.from(h2));
    expect(h1.length).toBe(32);
  });

  it('base32 encoding is lowercase', () => {
    const b = bytesToBase32(new Uint8Array([0xff, 0x00, 0xab]));
    expect(b).toMatch(/^[a-z2-7]+$/);
  });
});
// ============================================================
// Pairing code derivation (verifier for MITM protection)
// ============================================================
import { base64UrlToBytes, sha256, bytesToBase32 } from '@/crypto';

export async function computePairCode(pubA: string, pubB: string): Promise<string> {
  // Canonical order: sort the two pubkeys lexicographically
  const [a, b] = [pubA, pubB].sort();
  const concat = new Uint8Array([
    ...new TextEncoder().encode(a),
    ...new TextEncoder().encode(b),
  ]);
  const hash = await sha256(concat);
  return bytesToBase32(hash).slice(0, 6).toUpperCase();
}
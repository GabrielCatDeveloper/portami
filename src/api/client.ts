// ============================================================
// API client with signed envelopes + offline queue
// ============================================================
import {
  canonicalJSON,
  importPrivateKeyJwk,
  randomNonce,
  signMessage,
} from '@/crypto';
import { getDB } from '@/storage/db';
import { useIdentityStore } from '@/state/identity';
import type { SignedEnvelope } from '@/api/types';

const BASE = '/api';

export type FetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signed?: boolean;
  retries?: number;
};

// Generic signed fetch
export async function apiFetch<T = unknown>(
  path: string,
  opts: FetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, signed = false, retries = 2 } = opts;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let payload = body;
  if (signed && body !== undefined && method !== 'GET') {
    const id = await useIdentityStore.getState().ensure();
    const privKey = await importPrivateKeyJwk(id.privKeyJwk);
    const ts = Date.now();
    const nonce = randomNonce();
    const bodyStr = canonicalJSON(body);
    const sigInput = new TextEncoder().encode(
      `${id.pubKey}|${nonce}|${ts}|${bodyStr}`,
    );
    const sig = await signMessage(privKey, sigInput);
    const envelope: SignedEnvelope = {
      pub: id.pubKey,
      nonce,
      ts,
      body,
      sig,
    };
    payload = envelope;
    headers['X-Portami-Pub'] = id.pubKey;
    headers['X-Portami-Nonce'] = nonce;
    headers['X-Portami-Ts'] = String(ts);
    headers['X-Portami-Sig'] = sig;
  }

  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= retries) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} on ${path}`);
      }
      if (res.status === 204) return undefined as T;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        return (await res.json()) as T;
      }
      return undefined as T;
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > retries) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// Offline-aware signed POST: queues in IndexedDB on failure
export async function signedPostOrQueue<T = unknown>(
  path: string,
  body: unknown,
  queueKey: string,
): Promise<T | undefined> {
  try {
    return await apiFetch<T>(path, { method: 'POST', body, signed: true });
  } catch (err) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const db = await getDB();
      await db.put(
        // pendingSamples reuses trip queue shape; for arbitrary entities use a separate store
        // For simplicity, encode queue entry in body — server will validate after sync
        'pendingSamples' as any,
        {
          tripId: queueKey,
          ts: Date.now(),
          sample: { ts: Date.now(), lat: 0, lng: 0, acc: 0, _queued: body } as any,
        } as any,
      );
      return undefined;
    }
    throw err;
  }
}

// Drain offline queue (called when online event fires)
export async function drainOfflineQueue(): Promise<number> {
  if (!navigator.onLine) return 0;
  const db = await getDB();
  const items = await db.getAll('pendingSamples' as any);
  let drained = 0;
  for (const item of items as any[]) {
    const queued = item.sample?._queued;
    if (!queued) continue;
    try {
      await apiFetch('/queue/flush', { method: 'POST', body: queued, signed: true });
      await db.delete('pendingSamples' as any, item.tripId);
      drained++;
    } catch {
      // skip — leave in queue for next try
    }
  }
  return drained;
}
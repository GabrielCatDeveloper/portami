// ============================================================
// API client with signed envelopes + offline awareness.
// ============================================================
import {
  canonicalJSON,
  importPrivateKeyJwk,
  randomNonce,
  signMessage,
} from '@/crypto';
import { useIdentityStore } from '@/state/identity';
import type { SignedEnvelope } from '@/api/types';
import { backoffMs, getHealthSnapshot, subscribeHealth } from './health';

// API base URL. Empty by default (dev mode uses MSW).
// In production, set VITE_API_BASE=https://your-server.deno.dev at build time.
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export function getApiBase(): string {
  return BASE;
}

export type FetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signed?: boolean;
  retries?: number;
  /** When true, fetch will throw if the server is currently 'stopped'/'offline'
   *  instead of attempting the request. Use this for reads where you want to
   *  show offline UI immediately rather than wait for a timeout. */
  failFastIfOffline?: boolean;
};

/**
 * Generic fetch wrapper.
 * - Adds the signed envelope headers for non-GET, signed requests.
 * - Uses VITE_API_BASE if configured.
 * - Respects backoff when the server is saturated.
 * - Throws a ServerOfflineError when the server is unreachable.
 */
export class ServerOfflineError extends Error {
  constructor() {
    super('Server is offline');
    this.name = 'ServerOfflineError';
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: FetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, signed = false, retries = 2, failFastIfOffline = false } = opts;

  const health = getHealthSnapshot();
  if (!BASE && failFastIfOffline) {
    throw new ServerOfflineError();
  }
  if (health.status === 'offline' && failFastIfOffline) {
    throw new ServerOfflineError();
  }

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

  // All API routes in both the real server and the MSW mocks are
  // mounted under the `/api` prefix. Centralising the prefix here
  // means callers can keep using paths like `/routes/nearby` without
  // caring whether they hit a prefix-less mock layer.
  const API_PREFIX = '/api';
  const url = path.startsWith(API_PREFIX) ? `${BASE}${path}` : `${BASE}${API_PREFIX}${path}`;

  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= retries) {
    if (attempt > 0) {
      // Honour saturated backoff between retries
      const bo = backoffMs();
      await new Promise((r) => setTimeout(r, bo || 300 * 2 ** attempt));
    }
    try {
      const res = await fetch(url, {
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
      // Network errors -> server is unreachable; stop retrying fast.
      if (err instanceof TypeError && /fetch/i.test(err.message)) break;
      attempt++;
      if (attempt > retries) break;
    }
  }
  if (lastErr instanceof TypeError && /fetch/i.test(lastErr.message)) {
    throw new ServerOfflineError();
  }
  throw lastErr;
}

// Re-export for callers that want to react to status changes
export { subscribeHealth, getHealthSnapshot };
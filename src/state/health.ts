// React hook + provider for the server health store.
// Anywhere in the tree: const { status } = useServerHealth()

import { useSyncExternalStore } from 'react';
import {
  getHealthSnapshot,
  startHealthPolling,
  stopHealthPolling,
  subscribeHealth,
  type HealthSnapshot,
} from '@/api/health';

export function useServerHealth(): HealthSnapshot {
  // CRITICAL: pass `subscribeHealth` and `getHealthSnapshot` directly
  // (module-level references). Wrapping them in arrow functions
  // creates a fresh function on every render, which makes React's
  // internal useEffect re-subscribe on every render and produces an
  // infinite loop ("Maximum update depth exceeded" / React error
  // #185). The combined contract that avoids the loop:
  //   1. Stable subscribe/getSnapshot references (this file).
  //   2. subscribeHealth does NOT call the listener synchronously
  //      (see api/health.ts — calling it was the second trigger of
  //      the loop).
  //   3. snapshot() returns a stable reference when state is unchanged
  //      (cache keyed by state identity, see api/health.ts).
  return useSyncExternalStore(
    subscribeHealth,
    getHealthSnapshot,
    getHealthSnapshot,
  );
}

let started = false;
export function startServerHealthOnce(baseUrl: string): void {
  if (started) return;
  started = true;
  startHealthPolling(baseUrl);
}

export function stopServerHealth(): void {
  stopHealthPolling();
  started = false;
}